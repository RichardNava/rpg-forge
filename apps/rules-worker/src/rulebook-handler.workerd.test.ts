import { webCrypto } from "@repo/rules-analysis-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./env.js";
import worker from "./index.js";

const MIGRATION_DDL =
  'CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`); CREATE TABLE `rules_analysis_runs` (`run_id` text PRIMARY KEY NOT NULL, `analysis_id` text NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`); CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`); CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`); CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;';

const BASE_URL = "https://rules-worker.test";

function rulebookUrl(analysisId: string): string {
  return `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rulebook`;
}

function pdfBytes(payload = "hello integration rulebook"): Uint8Array {
  const encoder = new TextEncoder();
  const header = encoder.encode("%PDF-1.7\n");
  const body = encoder.encode(payload);
  const footer = encoder.encode("\n%%EOF");
  const bytes = new Uint8Array(header.length + body.length + footer.length);
  bytes.set(header, 0);
  bytes.set(body, header.length);
  bytes.set(footer, header.length + body.length);
  return bytes;
}

class StubWorkflowBinding {
  readonly created: Array<{ id: string; params: unknown }> = [];
  readonly terminated: string[] = [];

  async create(input: {
    id: string;
    params: { analysisId: string; ingestionId: string };
  }): Promise<{ id: string }> {
    this.created.push(input);
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

async function createSession(envBindings: Env): Promise<{
  analysisId: string;
  accessToken: string;
}> {
  const db = envBindings.DB as D1Database;
  const analysisId = crypto.randomUUID();
  const accessToken = "rulebook-token-" + analysisId;
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

function putRulebook(
  analysisId: string,
  accessToken: string,
  envBindings: Env,
  options: { consent?: boolean; contentType?: string; body?: Uint8Array } = {},
): Promise<Response> {
  const body = options.body ?? pdfBytes();
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": options.contentType ?? "application/pdf",
    "content-length": String(body.byteLength),
  };
  if (options.consent !== false) {
    headers["x-rules-upload-consent"] = "accepted";
  }
  return worker.fetch(
    new Request(rulebookUrl(analysisId), {
      method: "PUT",
      headers,
      body: body as unknown as BodyInit,
    }),
    envBindings,
  );
}

describe("rulebook handler integration (real D1 + R2, stubbed workflow binding)", () => {
  let db: D1Database;
  let bucket: R2Bucket;
  let stubWorkflow: StubWorkflowBinding;
  let realEnv: Env;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
    bucket = env.RULEBOOK_BUCKET as R2Bucket;
    stubWorkflow = new StubWorkflowBinding();
    realEnv = {
      DB: db,
      RULEBOOK_BUCKET: env.RULEBOOK_BUCKET,
      RULEBOOK_INGESTION_WORKFLOW: stubWorkflow as unknown as NonNullable<
        Env["RULEBOOK_INGESTION_WORKFLOW"]
      >,
      RATE_LIMIT_MODE: "local",
    };
  });

  it("PUT accepts a valid PDF, persists to D1 and R2, and starts the workflow", async () => {
    const { analysisId, accessToken } = await createSession(realEnv);
    const response = await putRulebook(analysisId, accessToken, realEnv);
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      status: string;
      sizeBytes: number;
    };
    expect(body.status).toBe("QUEUED");
    expect(body.sizeBytes).toBe(pdfBytes().byteLength);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const row = await db
      .prepare(
        "SELECT status, ingestion_id FROM rules_analysis_rulebooks WHERE analysis_id = ?",
      )
      .bind(analysisId)
      .first<{ status: string; ingestion_id: string }>();
    expect(row).not.toBeNull();
    expect(row!.status).toBe("QUEUED");

    const raw = await bucket.get(
      `temp/rules/${analysisId}/${row!.ingestion_id}/raw.pdf`,
    );
    expect(raw).not.toBeNull();
    expect(stubWorkflow.created).toHaveLength(1);
    expect(stubWorkflow.created[0]!.id).toBe(row!.ingestion_id);
  });

  it("rejects upload without consent before any durable write", async () => {
    const createdBefore = stubWorkflow.created.length;
    const { analysisId, accessToken } = await createSession(realEnv);
    const response = await putRulebook(analysisId, accessToken, realEnv, {
      consent: false,
    });
    expect(response.status).toBe(403);
    const row = await db
      .prepare("SELECT 1 FROM rules_analysis_rulebooks WHERE analysis_id = ?")
      .bind(analysisId)
      .first();
    expect(row).toBeNull();
    expect(stubWorkflow.created.length).toBe(createdBefore);
  });

  it("rejects invalid PDF signature and leaves no orphan reservation", async () => {
    const { analysisId, accessToken } = await createSession(realEnv);
    const response = await putRulebook(analysisId, accessToken, realEnv, {
      body: new TextEncoder().encode("this is not a pdf at all"),
    });
    expect(response.status).toBe(400);
    const row = await db
      .prepare(
        "SELECT status FROM rules_analysis_rulebooks WHERE analysis_id = ?",
      )
      .bind(analysisId)
      .first<{ status: string }>();
    expect(row).toBeNull();
  });

  it("isolation: upload A, delete A, upload B - stale A cannot touch B", async () => {
    const { analysisId, accessToken } = await createSession(realEnv);

    await putRulebook(analysisId, accessToken, realEnv);
    const first = await db
      .prepare(
        "SELECT ingestion_id FROM rules_analysis_rulebooks WHERE analysis_id = ?",
      )
      .bind(analysisId)
      .first<{ ingestion_id: string }>();
    expect(first).not.toBeNull();
    const ingestionA = first!.ingestion_id;

    const del = await worker.fetch(
      new Request(rulebookUrl(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      realEnv,
    );
    expect(del.status).toBe(204);
    expect(stubWorkflow.terminated).toContain(ingestionA);

    const secondPut = await putRulebook(analysisId, accessToken, realEnv);
    expect(secondPut.status).toBe(202);
    const second = await db
      .prepare(
        "SELECT ingestion_id FROM rules_analysis_rulebooks WHERE analysis_id = ?",
      )
      .bind(analysisId)
      .first<{ ingestion_id: string }>();
    expect(second).not.toBeNull();
    expect(second!.ingestion_id).not.toBe(ingestionA);

    const secondRaw = await bucket.get(
      `temp/rules/${analysisId}/${second!.ingestion_id}/raw.pdf`,
    );
    expect(secondRaw).not.toBeNull();
    const staleARaw = await bucket.get(
      `temp/rules/${analysisId}/${ingestionA}/raw.pdf`,
    );
    expect(staleARaw).toBeNull();
  });
});
