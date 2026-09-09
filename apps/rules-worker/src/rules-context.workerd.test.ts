import {
  EMBEDDING_BATCH_SIZE,
  RETRIEVAL_TOP_K,
  RULES_EMBEDDING_DIMENSIONS,
  runRulesAnalysisRun,
  type RunRulesAnalysisRunDeps,
} from "@repo/rules-analysis-run";
import type { RulebookChunk } from "@repo/rulebook-ingestion";
import { webCrypto } from "@repo/rules-analysis-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import worker from "./index.js";
import {
  MAX_RULES_ANALYSIS_OUTPUT_TOKENS,
  RULES_ANALYSIS_MODEL,
  createCloudflareAiRuleAnalysis,
} from "./infrastructure/ai-analysis.js";
import { AiProviderUnavailableError } from "./infrastructure/ai-errors.js";
import {
  RULES_EMBEDDING_MODEL,
  createCloudflareAiEmbeddings,
} from "./infrastructure/ai-embeddings.js";
import { systemClock } from "./infrastructure/clock.js";
import { createD1RulebookRepository } from "./infrastructure/db/rulebook-repository.js";
import { createD1RulesAnalysisRunRepository } from "./infrastructure/db/run-repository.js";
import { createR2RuleArtifacts } from "./infrastructure/r2-rule-artifacts.js";
import {
  VECTORIZE_UPSERT_BATCH_SIZE,
  createVectorizeIndex,
} from "./infrastructure/vectorize-index.js";

/**
 * Phase 14.4 rules-context smoke test. Runs the rules-context HTTP surface
 * against REAL local D1 + REAL local R2, with the Workers AI and Vectorize
 * behind deterministic recording stubs so no AI quota or remote index is ever
 * touched (per docs/architecture/phase-14/semantic-rules-analysis.md).
 *
 * Coverage:
 *  A - exact migration 0002 schema (rules_analysis_runs + single-current index)
 *      and the operational-only D1 run record produced by a real HTTP begin.
 *  B - exact R2 artifact layout temp/rules/<analysisId>/<ingestionId>/run/<runId>/
 *      written through the real adapters and read back over HTTP.
 *  C - Workers AI adapter settings (model ids, embedding batch bound, fixed
 *      dimension, analysis max_tokens + json_schema response_format).
 *  D - Vectorize adapter: shared index, namespace == ingestionId on every
 *      read/write, bounded upsert batches.
 *  E - full lifecycle smoke: begin -> complete -> read -> conflicts -> confirm;
 *      removing a rulebook invalidates a generation; a new generation is
 *      isolated and a stale run cannot mutate D1/R2.
 *
 * Workflows are stubbed (they are not executed), which is why the pipeline is
 * driven here by the domain run controller with deterministic fake providers
 * against the real D1/R2 adapters.
 */

const MIGRATION_DDL =
  'CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`); CREATE TABLE `rules_analysis_runs` (`run_id` text PRIMARY KEY NOT NULL, `analysis_id` text NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`); CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`); CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`); CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;';

const BASE_URL = "https://rules-worker.test";
const RULEBOOK_SOURCE_ID_PREFIX = "rulebook-";
const SHA256_FIXTURE =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

interface SeededSession {
  analysisId: string;
  accessToken: string;
}

interface PublicRunView {
  runId: string;
  analysisId: string;
  status: string;
}

interface BeginResponse {
  run: PublicRunView;
}

interface ContextReadResponse {
  run: PublicRunView;
  context: {
    schemaVersion: string;
    analysisId: string;
    sources: Array<{ id: string }>;
    normalizedRules: Array<{ id: string; key: string }>;
    conflicts: Array<{ id: string; status: string }>;
    status: string;
  } | null;
}

async function seedSession(db: D1Database): Promise<SeededSession> {
  const analysisId = crypto.randomUUID();
  const accessToken = "rules-context-token-" + analysisId;
  const tokenHash = await webCrypto.sha256Hex(
    new TextEncoder().encode(accessToken),
  );
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO rules_analysis_sessions (analysis_id, token_hash, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(analysisId, tokenHash, "ACTIVE", now, now, now + 12 * 60 * 60 * 1000)
    .run();
  return { analysisId, accessToken };
}

async function seedReadyRulebook(
  db: D1Database,
  analysisId: string,
): Promise<string> {
  const ingestionId = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO rules_analysis_rulebooks (analysis_id, ingestion_id, status, size_bytes, page_count, chunk_count, extracted_chars, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(analysisId, ingestionId, "READY", 654, 1, 1, 600, null, now, now)
    .run();
  return ingestionId;
}

const CHUNK_TEXT = "A single page of rule text used as retrieval evidence.";

function makeChunk(chunkId: string): RulebookChunk {
  return {
    version: 1,
    chunkId,
    pageStart: 1,
    pageEnd: 1,
    text: CHUNK_TEXT,
  };
}

function readyAnalysisJson(
  ruleId: string,
  chunkId: string,
  key: string,
): string {
  return JSON.stringify({
    normalizedRules: [
      {
        id: ruleId,
        category: "skills",
        key,
        summary: "The character moves unseen when remaining still.",
        evidence: [{ chunkId, quote: CHUNK_TEXT }],
        confidence: 0.9,
      },
    ],
    conflicts: [],
  });
}

const CONFLICTS_ANALYSIS_JSON = JSON.stringify({
  normalizedRules: [
    {
      id: "rule-c-1",
      category: "senses",
      key: "darkvision",
      summary: "Vision in darkness to 60 feet.",
      evidence: [{ chunkId: "chunk-id-1", quote: CHUNK_TEXT }],
      confidence: 0.7,
    },
    {
      id: "rule-c-2",
      category: "senses",
      key: "darkvision",
      summary: "Vision in darkness to 120 feet.",
      evidence: [{ chunkId: "chunk-id-1", quote: CHUNK_TEXT }],
      confidence: 0.8,
    },
  ],
  conflicts: [
    {
      id: "conflict-1",
      category: "senses",
      key: "darkvision",
      description: "The sources disagree on darkvision range.",
      competingRuleIds: ["rule-c-1", "rule-c-2"],
      competingSourceIds: [],
    },
  ],
});

function deterministicVector(text: string): number[] {
  const values = new Array<number>(RULES_EMBEDDING_DIMENSIONS).fill(0.5);
  let seed = 0;
  for (const char of text) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  values[0] = (seed % 251) / 1000;
  return values;
}

/** Recording fake for the Workers AI binding. No provider call is made. */
class StubAi {
  readonly calls: Array<{ model: string; input: unknown }> = [];
  private analysisResponse: string | null = null;

  setAnalysisResponse(json: string): void {
    this.analysisResponse = json;
  }

  async run(model: string, input: unknown): Promise<unknown> {
    this.calls.push({ model, input });
    if (model === RULES_EMBEDDING_MODEL) {
      const texts = (input as { text: string[] }).text;
      if (!Array.isArray(texts)) {
        throw new Error("Unexpected embeddings input shape.");
      }
      return {
        shape: [texts.length, RULES_EMBEDDING_DIMENSIONS],
        data: texts.map((text) => deterministicVector(text)),
      };
    }
    if (model === RULES_ANALYSIS_MODEL) {
      if (this.analysisResponse === null) {
        throw new Error("No scripted analysis response.");
      }
      return { response: this.analysisResponse };
    }
    throw new Error(`Unexpected Workers AI model: ${model}`);
  }
}

interface StubVectorRecord {
  id: string;
  values: number[];
  namespace: string;
}

/** Functional in-memory Vectorize stub. Deterministic; never a real index. */
class StubVectorizeIndex {
  private readonly namespaces = new Map<string, Map<string, number[]>>();
  readonly upsertCalls: StubVectorRecord[][] = [];
  readonly queryCalls: Array<{ namespace: string; topK: number }> = [];
  readonly deleteCalls: string[][] = [];

  async upsert(records: StubVectorRecord[]): Promise<void> {
    this.upsertCalls.push(records);
    for (const record of records) {
      let namespace = this.namespaces.get(record.namespace);
      if (namespace === undefined) {
        namespace = new Map<string, number[]>();
        this.namespaces.set(record.namespace, namespace);
      }
      namespace.set(record.id, record.values);
    }
  }

  async query(
    _vector: number[],
    options: {
      namespace?: string;
      topK?: number;
      returnValues?: boolean;
      returnMetadata?: boolean;
    },
  ): Promise<{ matches: Array<{ id: string }> }> {
    this.queryCalls.push({
      namespace: options.namespace ?? "",
      topK: options.topK ?? 0,
    });
    const namespace = options.namespace
      ? this.namespaces.get(options.namespace)
      : undefined;
    const matches = [...(namespace?.keys() ?? [])]
      .slice(0, options.topK ?? 0)
      .map((id) => ({ id }));
    return { matches };
  }

  async getByIds(
    ids: string[],
  ): Promise<Array<{ id: string; values: number[] }>> {
    const found: Array<{ id: string; values: number[] }> = [];
    for (const namespace of this.namespaces.values()) {
      for (const id of ids) {
        const values = namespace.get(id);
        if (values !== undefined) {
          found.push({ id, values });
        }
      }
    }
    return found;
  }

  async deleteByIds(ids: string[]): Promise<void> {
    this.deleteCalls.push([...ids]);
    for (const namespace of this.namespaces.values()) {
      for (const id of ids) {
        namespace.delete(id);
      }
    }
  }

  storedNamespaceIds(namespace: string): string[] {
    return [...(this.namespaces.get(namespace)?.keys() ?? [])];
  }
}

class StubRulebookIngestionWorkflow {
  readonly started: string[] = [];
  readonly terminated: string[] = [];

  async create(input: {
    id: string;
    params: { analysisId: string; ingestionId: string };
  }): Promise<{ id: string }> {
    this.started.push(input.id);
    return { id: input.id };
  }

  async get(id: string): Promise<{
    status(): Promise<{ status: string }>;
    terminate(): Promise<void>;
  }> {
    return {
      status: async () => ({ status: "running" }),
      terminate: async () => {
        this.terminated.push(id);
      },
    };
  }
}

class StubRulesAnalysisWorkflow {
  readonly started: Array<{
    analysisId: string;
    ingestionId: string;
    rulesAnalysisRunId: string;
  }> = [];

  async create(input: {
    id: string;
    params: {
      analysisId: string;
      ingestionId: string;
      rulesAnalysisRunId: string;
    };
  }): Promise<{ id: string }> {
    this.started.push(input.params);
    return { id: input.id };
  }

  async get(_id: string): Promise<{ status(): Promise<{ status: string }> }> {
    return {
      status: async () => ({ status: "unknown" }),
    };
  }

  startedWith(rulesAnalysisRunId: string): boolean {
    return this.started.some(
      (input) => input.rulesAnalysisRunId === rulesAnalysisRunId,
    );
  }
}

function rulesContextUrl(analysisId: string): string {
  return `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rules-context`;
}

function confirmationUrl(analysisId: string): string {
  return `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rules-context/confirmation`;
}

function rulebookUrl(analysisId: string): string {
  return `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rulebook`;
}

function runArtifactKey(
  analysisId: string,
  ingestionId: string,
  runId: string,
  artifact: string,
): string {
  return `temp/rules/${analysisId}/${ingestionId}/run/${runId}/${artifact}.json`;
}

function postBegin(
  session: SeededSession,
  body: unknown,
  envBindings: Env,
): Promise<Response> {
  return worker.fetch(
    new Request(rulesContextUrl(session.analysisId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    envBindings,
  );
}

function getRulesContext(
  session: SeededSession,
  envBindings: Env,
): Promise<Response> {
  return worker.fetch(
    new Request(rulesContextUrl(session.analysisId), {
      headers: { authorization: `Bearer ${session.accessToken}` },
    }),
    envBindings,
  );
}

function postConfirmation(
  session: SeededSession,
  envBindings: Env,
): Promise<Response> {
  return worker.fetch(
    new Request(confirmationUrl(session.analysisId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
    envBindings,
  );
}

describe("rules-context smoke (real D1 + R2, deterministic AI/Vectorize stubs)", () => {
  let db: D1Database;
  let bucket: R2Bucket;
  let stubVectorize: StubVectorizeIndex;
  let ingestionWorkflow: StubRulebookIngestionWorkflow;
  let analysisWorkflow: StubRulesAnalysisWorkflow;
  let realEnv: Env;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
    bucket = env.RULEBOOK_BUCKET as R2Bucket;
    stubVectorize = new StubVectorizeIndex();
    ingestionWorkflow = new StubRulebookIngestionWorkflow();
    analysisWorkflow = new StubRulesAnalysisWorkflow();
    realEnv = {
      DB: db,
      RULEBOOK_BUCKET: bucket,
      RULEBOOK_INGESTION_WORKFLOW: ingestionWorkflow as unknown as NonNullable<
        Env["RULEBOOK_INGESTION_WORKFLOW"]
      >,
      RULES_ANALYSIS_WORKFLOW: analysisWorkflow as unknown as NonNullable<
        Env["RULES_ANALYSIS_WORKFLOW"]
      >,
      VECTORIZE: stubVectorize as unknown as NonNullable<Env["VECTORIZE"]>,
      RATE_LIMIT_MODE: "local",
    };
  });

  function createPipelineDeps(options: {
    chunks: RulebookChunk[];
    analysisJson: string;
  }): RunRulesAnalysisRunDeps {
    const stubAi = new StubAi();
    stubAi.setAnalysisResponse(options.analysisJson);
    return {
      clock: systemClock,
      runRepository: createD1RulesAnalysisRunRepository(db, {
        clock: systemClock,
      }),
      rulebookRepository: createD1RulebookRepository(db, {
        clock: systemClock,
      }),
      chunkSource: {
        readChunks: async () => options.chunks,
      },
      fileHash: {
        hashRulebookRaw: async () => SHA256_FIXTURE,
      },
      embeddings: createCloudflareAiEmbeddings(stubAi as unknown as Ai),
      vectorIndex: createVectorizeIndex(
        stubVectorize as unknown as VectorizeIndex,
      ),
      analysis: createCloudflareAiRuleAnalysis(stubAi as unknown as Ai),
      artifactStore: createR2RuleArtifacts(bucket),
    };
  }

  async function runPipelineToCompletion(options: {
    analysisId: string;
    runId: string;
    chunks: RulebookChunk[];
    analysisJson: string;
  }): Promise<"READY" | "CONFLICTS"> {
    const result = await runRulesAnalysisRun(
      { analysisId: options.analysisId, runId: options.runId },
      createPipelineDeps(options),
    );
    expect(result.kind).toBe("completed");
    return result.kind === "completed" ? result.status : "READY";
  }

  it("begin returns 409 before any READY rulebook exists", async () => {
    const session = await seedSession(db);
    const response = await postBegin(
      session,
      { characterIntent: { summary: "No rulebook should be found." } },
      realEnv,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_NO_READY_RULEBOOK");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("A: migration 0002 schema on real D1 and an operational-only run record", async () => {
    const indexes = await db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rules_analysis_runs' ORDER BY name",
      )
      .all<{ name: string; sql: string | null }>();
    expect(
      indexes.results
        .filter((row) => !row.name.startsWith("sqlite_autoindex_"))
        .map((row) => row.name),
    ).toEqual([
      "rules_analysis_runs_cleanup_idx",
      "rules_analysis_runs_current_idx",
      "rules_analysis_runs_generation_idx",
      "rules_analysis_runs_single_current_idx",
    ]);
    const singleCurrent = indexes.results.find(
      (row) => row.name === "rules_analysis_runs_single_current_idx",
    );
    expect(singleCurrent?.sql).toContain(
      'WHERE "rules_analysis_runs"."is_current" = 1',
    );

    const columns = await db
      .prepare("PRAGMA table_info(rules_analysis_runs)")
      .all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "run_id",
      "analysis_id",
      "ingestion_id",
      "status",
      "failure_code",
      "is_current",
      "created_at",
      "updated_at",
    ]);

    const session = await seedSession(db);
    const ingestionId = await seedReadyRulebook(db, session.analysisId);
    const response = await postBegin(
      session,
      {
        characterIntent: {
          summary: "A contact-heavy rogue collecting leverage.",
        },
        ruleOverrides: [
          { key: "starting-wealth", summary: "Rogues keep the full pouch." },
        ],
      },
      realEnv,
    );
    expect(response.status).toBe(202);
    const row = await db
      .prepare(
        "SELECT run_id, analysis_id, ingestion_id, status, failure_code, is_current, created_at, updated_at FROM rules_analysis_runs LIMIT 1",
      )
      .first<{
        run_id: string;
        analysis_id: string;
        ingestion_id: string;
        status: string;
        failure_code: string | null;
        is_current: number;
        created_at: number;
        updated_at: number;
      }>();
    expect(row).not.toBeNull();
    expect(row!.analysis_id).toBe(session.analysisId);
    expect(row!.ingestion_id).toBe(ingestionId);
    expect(row!.status).toBe("QUEUED");
    expect(row!.failure_code).toBeNull();
    expect(row!.is_current).toBe(1);
    expect(row!.created_at).toBeGreaterThan(0);
    expect(row!.updated_at).toBe(row!.created_at);
  });

  it("B: HTTP begin + pipeline write the exact R2 run artifact layout", async () => {
    const session = await seedSession(db);
    const ingestionId = await seedReadyRulebook(db, session.analysisId);
    const intentSummary = "A scout who always knows the exits.";

    const begin = await postBegin(
      session,
      { characterIntent: { summary: intentSummary } },
      realEnv,
    );
    expect(begin.status).toBe(202);
    const beginBody = (await begin.json()) as BeginResponse;
    const runId = beginBody.run.runId;
    expect(beginBody.run.analysisId).toBe(session.analysisId);
    expect(beginBody.run.status).toBe("QUEUED");
    expect(analysisWorkflow.startedWith(runId)).toBe(true);

    const inputKey = runArtifactKey(
      session.analysisId,
      ingestionId,
      runId,
      "input",
    );
    const inputObject = await bucket.get(inputKey);
    expect(inputObject).not.toBeNull();
    const input = (await inputObject!.json()) as {
      version: number;
      runId: string;
      analysisId: string;
      ingestionId: string;
      characterIntent: { summary: string };
      ruleOverrides: Array<{ key: string; sourceId: string }>;
    };
    expect(input.version).toBe(1);
    expect(input.runId).toBe(runId);
    expect(input.analysisId).toBe(session.analysisId);
    expect(input.ingestionId).toBe(ingestionId);
    expect(input.characterIntent.summary).toBe(intentSummary);
    expect(input.ruleOverrides).toEqual([]);

    const queuedRead = await getRulesContext(session, realEnv);
    expect(queuedRead.status).toBe(202);
    expect(
      ((await queuedRead.json()) as ContextReadResponse).context,
    ).toBeNull();

    const completed = await runPipelineToCompletion({
      analysisId: session.analysisId,
      runId,
      chunks: [makeChunk("chunk-id-1")],
      analysisJson: readyAnalysisJson("rule-1", "chunk-id-1", "stealth-a"),
    });
    expect(completed).toBe("READY");

    for (const artifact of ["context", "retrieval", "vector-manifest"]) {
      const object = await bucket.get(
        runArtifactKey(session.analysisId, ingestionId, runId, artifact),
      );
      expect(object).not.toBeNull();
    }

    const contextObject = await bucket.get(
      runArtifactKey(session.analysisId, ingestionId, runId, "context"),
    );
    const storedContext = (await contextObject!.json()) as {
      schemaVersion: string;
      analysisId: string;
      sources: Array<{ id: string }>;
      status: string;
    };
    expect(storedContext.schemaVersion).toBe("1");
    expect(storedContext.analysisId).toBe(session.analysisId);
    expect(storedContext.sources[0]?.id).toBe(
      RULEBOOK_SOURCE_ID_PREFIX + ingestionId,
    );
    expect(storedContext.status).toBe("ready");

    const read = await getRulesContext(session, realEnv);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as ContextReadResponse;
    expect(readBody.run.status).toBe("READY");
    expect(readBody.context?.status).toBe("ready");
    expect(readBody.context?.analysisId).toBe(session.analysisId);
  });

  it("C: Workers AI adapter settings are deterministic and exact", async () => {
    const embedStub = new StubAi();
    const embeddings = createCloudflareAiEmbeddings(embedStub as unknown as Ai);

    const vectors = await embeddings.embed(["alpha", "beta"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.length).toBe(RULES_EMBEDDING_DIMENSIONS);
    expect(vectors[1]?.length).toBe(RULES_EMBEDDING_DIMENSIONS);
    expect(vectors[0]).not.toEqual(vectors[1]);

    const embedCall = embedStub.calls.find(
      (call) => call.model === RULES_EMBEDDING_MODEL,
    );
    expect(embedCall).toBeDefined();
    expect(embedCall!.input).toEqual({ text: ["alpha", "beta"] });

    await expect(
      embeddings.embed(
        Array.from(
          { length: EMBEDDING_BATCH_SIZE + 1 },
          (_, index) => `t${index}`,
        ),
      ),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);

    const analysisStub = new StubAi();
    analysisStub.setAnalysisResponse(`{"normalizedRules":[],"conflicts":[]}`);
    const analysis = createCloudflareAiRuleAnalysis(
      analysisStub as unknown as Ai,
    );
    const raw = await analysis.generate({
      system: "trusted instructions",
      user: "smoke analysis prompt",
    });
    expect(raw).toBe(`{"normalizedRules":[],"conflicts":[]}`);

    const analysisCall = analysisStub.calls.find(
      (call) => call.model === RULES_ANALYSIS_MODEL,
    );
    expect(analysisCall).toBeDefined();
    const input = analysisCall!.input as {
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
      response_format: { type: string; json_schema: unknown };
    };
    expect(input.messages).toEqual([
      { role: "system", content: "trusted instructions" },
      { role: "user", content: "smoke analysis prompt" },
    ]);
    expect(input.max_tokens).toBe(MAX_RULES_ANALYSIS_OUTPUT_TOKENS);
    expect(input.response_format.type).toBe("json_schema");
    expect(input.response_format.json_schema).toBeTypeOf("object");
    expect("tools" in input).toBe(false);
  });

  it("D: Vectorize adapter is shared, namespace == ingestionId, batched upserts", async () => {
    const freshStub = new StubVectorizeIndex();
    const index = createVectorizeIndex(freshStub as unknown as VectorizeIndex);
    const namespace = crypto.randomUUID();
    const vectors = Array.from(
      { length: VECTORIZE_UPSERT_BATCH_SIZE * 2 + 1 },
      (_, i) => ({
        id: `v-${i}`,
        values: deterministicVector(`v-${i}`),
      }),
    );

    await index.upsert({ namespace, vectors });
    expect(freshStub.upsertCalls).toHaveLength(3);
    expect(freshStub.upsertCalls.map((batch) => batch.length)).toEqual([
      VECTORIZE_UPSERT_BATCH_SIZE,
      VECTORIZE_UPSERT_BATCH_SIZE,
      1,
    ]);
    for (const batch of freshStub.upsertCalls) {
      expect(batch.every((record) => record.namespace === namespace)).toBe(
        true,
      );
    }

    const retrieved = await index.query({
      namespace,
      vector: deterministicVector("query"),
      topK: RETRIEVAL_TOP_K,
    });
    expect(retrieved).toHaveLength(RETRIEVAL_TOP_K);
    expect(freshStub.queryCalls.at(-1)).toEqual({
      namespace,
      topK: RETRIEVAL_TOP_K,
    });

    await index.deleteByIds({ namespace, ids: ["v-0", "v-1"] });
    expect(freshStub.deleteCalls).toEqual([["v-0", "v-1"]]);
    expect(freshStub.storedNamespaceIds(namespace)).toHaveLength(
      vectors.length - 2,
    );
  });

  it("E1: conflicts surface and confirmation transitions CONFLICTS -> CONFIRMED", async () => {
    const session = await seedSession(db);
    const ingestionId = await seedReadyRulebook(db, session.analysisId);

    const begin = await postBegin(
      session,
      { characterIntent: { summary: "An elf scout with sharp sight." } },
      realEnv,
    );
    expect(begin.status).toBe(202);
    const beginBody = (await begin.json()) as BeginResponse;
    const runId = beginBody.run.runId;

    const completed = await runPipelineToCompletion({
      analysisId: session.analysisId,
      runId,
      chunks: [makeChunk("chunk-id-1")],
      analysisJson: CONFLICTS_ANALYSIS_JSON,
    });
    expect(completed).toBe("CONFLICTS");

    const conflictsRead = await getRulesContext(session, realEnv);
    expect(conflictsRead.status).toBe(200);
    const conflictsBody = (await conflictsRead.json()) as ContextReadResponse;
    expect(conflictsBody.run.status).toBe("CONFLICTS");
    expect(conflictsBody.context?.status).toBe("conflicts");
    expect(conflictsBody.context?.conflicts).toHaveLength(1);
    expect(conflictsBody.context?.conflicts[0]?.status).toBe("unresolved");

    const confirm = await postConfirmation(session, realEnv);
    expect(confirm.status).toBe(200);
    const confirmedBody = (await confirm.json()) as BeginResponse;
    expect(confirmedBody.run.status).toBe("CONFIRMED");

    const storedContext = (await (await bucket.get(
      runArtifactKey(session.analysisId, ingestionId, runId, "context"),
    ))!.json()) as { status: string; conflicts: Array<{ status: string }> };
    expect(storedContext.status).toBe("ready");
    expect(storedContext.conflicts[0]?.status).toBe("resolved");

    const after = await getRulesContext(session, realEnv);
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as ContextReadResponse;
    expect(afterBody.run.status).toBe("CONFIRMED");
    expect(afterBody.context?.status).toBe("ready");

    const guarded = await postConfirmation(session, realEnv);
    expect(guarded.status).toBe(409);
  });

  it("E2: removing a rulebook invalidates generation A; generation B is isolated", async () => {
    const session = await seedSession(db);
    const ingestionA = await seedReadyRulebook(db, session.analysisId);

    const beginA = await postBegin(
      session,
      { characterIntent: { summary: "Generation A character." } },
      realEnv,
    );
    expect(beginA.status).toBe(202);
    const beginABody = (await beginA.json()) as BeginResponse;
    const runA = beginABody.run.runId;

    const completedA = await runPipelineToCompletion({
      analysisId: session.analysisId,
      runId: runA,
      chunks: [makeChunk("chunk-a")],
      analysisJson: readyAnalysisJson("rule-a", "chunk-a", "stealth-a"),
    });
    expect(completedA).toBe("READY");

    const readyRead = await getRulesContext(session, realEnv);
    expect(readyRead.status).toBe(200);
    expect(
      ((await readyRead.json()) as ContextReadResponse).context
        ?.normalizedRules[0]?.id,
    ).toBe("rule-a");

    const del = await worker.fetch(
      new Request(rulebookUrl(session.analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      }),
      realEnv,
    );
    expect(del.status).toBe(204);
    expect(ingestionWorkflow.terminated).toContain(ingestionA);

    const invalidated = await db
      .prepare(
        "SELECT status, is_current FROM rules_analysis_runs WHERE run_id = ?",
      )
      .bind(runA)
      .first<{ status: string; is_current: number }>();
    expect(invalidated?.status).toBe("INVALIDATED");
    expect(invalidated?.is_current).toBe(0);
    expect(
      await bucket.get(
        runArtifactKey(session.analysisId, ingestionA, runA, "context"),
      ),
    ).toBeNull();
    expect(stubVectorize.storedNamespaceIds(ingestionA)).toHaveLength(0);

    const gone = await getRulesContext(session, realEnv);
    expect(gone.status).toBe(404);

    const ingestionB = await seedReadyRulebook(db, session.analysisId);
    const beginB = await postBegin(
      session,
      { characterIntent: { summary: "Generation B character." } },
      realEnv,
    );
    expect(beginB.status).toBe(202);
    const beginBBody = (await beginB.json()) as BeginResponse;
    const runB = beginBBody.run.runId;
    const inputBKey = runArtifactKey(
      session.analysisId,
      ingestionB,
      runB,
      "input",
    );
    expect(await bucket.get(inputBKey)).not.toBeNull();

    const completedB = await runPipelineToCompletion({
      analysisId: session.analysisId,
      runId: runB,
      chunks: [makeChunk("chunk-b")],
      analysisJson: readyAnalysisJson("rule-b", "chunk-b", "stealth-b"),
    });
    expect(completedB).toBe("READY");

    const readB = await getRulesContext(session, realEnv);
    expect(readB.status).toBe(200);
    const bodyB = (await readB.json()) as ContextReadResponse;
    expect(bodyB.run.runId).toBe(runB);
    expect(bodyB.context?.analysisId).toBe(session.analysisId);
    expect(bodyB.context?.sources[0]?.id).toBe(
      RULEBOOK_SOURCE_ID_PREFIX + ingestionB,
    );
    expect(bodyB.context?.normalizedRules[0]?.id).toBe("rule-b");

    const stale = await runRulesAnalysisRun(
      { analysisId: session.analysisId, runId: runA },
      createPipelineDeps({
        chunks: [makeChunk("chunk-a")],
        analysisJson: readyAnalysisJson("rule-a", "chunk-a", "stealth-a"),
      }),
    );
    expect(stale.kind).toBe("not_current");
    const staleRow = await db
      .prepare(
        "SELECT status, is_current FROM rules_analysis_runs WHERE run_id = ?",
      )
      .bind(runA)
      .first<{ status: string; is_current: number }>();
    expect(staleRow?.status).toBe("INVALIDATED");
    expect(staleRow?.is_current).toBe(0);
    expect(
      await bucket.get(
        runArtifactKey(session.analysisId, ingestionA, runA, "context"),
      ),
    ).toBeNull();
    expect(
      await bucket.get(
        runArtifactKey(session.analysisId, ingestionB, runB, "context"),
      ),
    ).not.toBeNull();
  });
});
