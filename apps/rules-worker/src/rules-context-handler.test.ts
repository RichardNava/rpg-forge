import { describe, expect, it } from "vitest";
import {
  type RuleBuildFailureCode,
  type RulesAnalysisRun,
  type RulesAnalysisRunStatus,
} from "@repo/rules-analysis-run";
import { RulesContextSchema, type RulesContext } from "@repo/rules-context";
import { handleRequest, type AppDeps } from "./handler.js";
import {
  FakeClock,
  FakeCrypto,
  FakeHumanVerification,
  FakeRateLimiter,
  FakeResourceCleaner,
  FakeRulesAnalysisRunRepository,
  FakeRulesAnalysisWorkflow,
  FakeRulebookRepository,
  FakeRulebookStorage,
  FakeRulebookWorkflow,
  FakeRunArtifactStore,
  FakeSessionRepository,
  FakeVectorIndex,
  FakeSheetSessionRepository,
  FakeDraftHeadRepository,
} from "./test/fakes.js";

const BASE_URL = "https://rules-worker.test";
const BEGIN_BODY = {
  characterIntent: { summary: "Create a veteran wilderness explorer." },
};

const RULES_CONTEXT_URL = (analysisId: string) =>
  `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rules-context`;
const RULES_CONTEXT_CONFIRM_URL = (analysisId: string) =>
  `${RULES_CONTEXT_URL(analysisId)}/confirmation`;
const RULEBOOK_URL = (analysisId: string) =>
  `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rulebook`;

interface Harness {
  deps: AppDeps;
  clock: FakeClock;
  crypto: FakeCrypto;
  rateLimiter: FakeRateLimiter;
  rulebookRepository: FakeRulebookRepository;
  rulebookStorage: FakeRulebookStorage;
  rulebookWorkflow: FakeRulebookWorkflow;
  rulesAnalysisRunRepository: FakeRulesAnalysisRunRepository;
  artifactStore: FakeRunArtifactStore;
  vectorIndex: FakeVectorIndex;
  rulesAnalysisWorkflow: FakeRulesAnalysisWorkflow;
}

function makeHarness(): Harness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const rateLimiter = new FakeRateLimiter();
  const rulebookRepository = new FakeRulebookRepository(clock);
  const rulebookStorage = new FakeRulebookStorage();
  const rulebookWorkflow = new FakeRulebookWorkflow();
  const rulesAnalysisRunRepository = new FakeRulesAnalysisRunRepository();
  const artifactStore = new FakeRunArtifactStore();
  const vectorIndex = new FakeVectorIndex();
  const rulesAnalysisWorkflow = new FakeRulesAnalysisWorkflow();
  const deps: AppDeps = {
    crypto,
    clock,
    repository: new FakeSessionRepository(),
    cleaner: new FakeResourceCleaner(),
    humanVerifier: new FakeHumanVerification(),
    rateLimiter,
    rulebookRepository,
    rulebookStorage,
    rulebookWorkflow,
    rulesAnalysisRunRepository,
    rulesAnalysisArtifactStore: artifactStore,
    rulesAnalysisVectorIndex: vectorIndex,
    rulesAnalysisWorkflow,
    sheetSessionRepository: new FakeSheetSessionRepository(),
    sheetDraftHeadRepository: new FakeDraftHeadRepository(),
  };
  return {
    deps,
    clock,
    crypto,
    rateLimiter,
    rulebookRepository,
    rulebookStorage,
    rulebookWorkflow,
    rulesAnalysisRunRepository,
    artifactStore,
    vectorIndex,
    rulesAnalysisWorkflow,
  };
}

async function createSession(harness: Harness): Promise<{
  analysisId: string;
  accessToken: string;
}> {
  const response = await handleRequest(
    new Request(`${BASE_URL}/v1/rules-analysis/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "turnstile-ok" }),
    }),
    harness.deps,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { analysisId: string; accessToken: string };
}

function seedRulebook(
  harness: Harness,
  analysisId: string,
  status: "QUEUED" | "READY" = "READY",
): { ingestionId: string } {
  const ingestionId = harness.crypto.uuid();
  harness.rulebookRepository.rows.set(analysisId, {
    analysisId,
    ingestionId,
    status,
    sizeBytes: 123,
    pageCount: status === "READY" ? 1 : null,
    chunkCount: status === "READY" ? 1 : null,
    extractedChars: status === "READY" ? 1_000 : null,
    failureCode: null,
    createdAt: harness.clock.now(),
    updatedAt: harness.clock.now(),
  });
  return { ingestionId };
}

function seedRun(
  harness: Harness,
  input: {
    analysisId: string;
    ingestionId: string;
    status: RulesAnalysisRunStatus;
    failureCode?: RuleBuildFailureCode;
  },
): RulesAnalysisRun {
  const run: RulesAnalysisRun = {
    runId: harness.crypto.uuid(),
    analysisId: input.analysisId,
    ingestionId: input.ingestionId,
    status: input.status,
    failureCode: input.failureCode ?? null,
    isCurrent: true,
    createdAt: harness.clock.now(),
    updatedAt: harness.clock.now(),
  };
  harness.rulesAnalysisRunRepository.rows.set(run.runId, run);
  return run;
}

function readyContext(analysisId: string): RulesContext {
  return RulesContextSchema.parse({
    schemaVersion: "1",
    analysisId,
    sources: [
      {
        id: "preset-1",
        type: "preset",
        systemKey: "generic-fantasy",
        editionKey: "core",
        displayName: "Generic Fantasy Core",
      },
    ],
    authorityOrder: ["preset-1"],
    characterIntent: { summary: "Create a veteran wilderness explorer." },
    ruleOverrides: [],
    normalizedRules: [
      {
        id: "rule-initiative-order",
        category: "combat",
        key: "initiative-order",
        summary: "Participants act from highest initiative to lowest.",
        structuredValue: { order: "descending" },
        citations: [
          {
            sourceId: "preset-1",
            pageStart: null,
            pageEnd: null,
            section: "Combat",
            chunkId: "preset-combat-1",
          },
        ],
        confidence: 0.9,
      },
    ],
    conflicts: [],
    status: "ready",
  });
}

function conflictsContext(analysisId: string): RulesContext {
  return RulesContextSchema.parse({
    schemaVersion: "1",
    analysisId,
    sources: [
      {
        id: "preset-1",
        type: "preset",
        systemKey: "generic-fantasy",
        editionKey: "core",
        displayName: "Generic Fantasy Core",
      },
      {
        id: "preset-2",
        type: "preset",
        systemKey: "generic-sci-fi",
        editionKey: "core",
        displayName: "Generic Sci-Fi Core",
      },
    ],
    authorityOrder: ["preset-1", "preset-2"],
    characterIntent: { summary: "Create a veteran wilderness explorer." },
    ruleOverrides: [],
    normalizedRules: [
      {
        id: "rule-a",
        category: "combat",
        key: "critical-range",
        summary: "Critical success occurs on 19 or 20.",
        structuredValue: { minimum: 19, maximum: 20 },
        citations: [
          {
            sourceId: "preset-1",
            pageStart: null,
            pageEnd: null,
            section: "Combat",
            chunkId: "preset-combat-1",
          },
        ],
        confidence: 0.9,
      },
      {
        id: "rule-b",
        category: "combat",
        key: "critical-range",
        summary: "Critical success occurs on 20 only.",
        structuredValue: { minimum: 20, maximum: 20 },
        citations: [
          {
            sourceId: "preset-2",
            pageStart: null,
            pageEnd: null,
            section: "Combat",
            chunkId: "preset-combat-2",
          },
        ],
        confidence: 0.9,
      },
    ],
    conflicts: [
      {
        id: "conflict-1",
        category: "combat",
        key: "critical-range",
        description: "The sources disagree on the critical success range.",
        competingRuleIds: ["rule-a", "rule-b"],
        competingSourceIds: ["preset-1", "preset-2"],
        status: "unresolved",
        resolution: null,
      },
    ],
    status: "conflicts",
  });
}

describe("rules-context begin", () => {
  it("returns 409 when no ready rulebook exists", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_NO_READY_RULEBOOK");
  });

  it("fails closed when artifact storage is unavailable", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    seedRulebook(harness, analysisId);
    delete harness.deps.rulesAnalysisArtifactStore;
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  });

  it("levels rate limit per session and client IP before starting a run", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    harness.rateLimiter.result = { kind: "denied" };
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          "cf-connecting-ip": "1.2.3.4",
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(harness.rateLimiter.calls.at(-1)).toBe(
      `rules-context-begin:${analysisId}:1.2.3.4`,
    );
  });

  it("returns 202 with a queued run and starts the analysis workflow", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    seedRulebook(harness, analysisId);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      run: { status: string; analysisId: string };
    };
    expect(body.run.status).toBe("QUEUED");
    expect(body.run.analysisId).toBe(analysisId);
    expect(harness.rulesAnalysisWorkflow.started).toHaveLength(1);
    expect(harness.rulesAnalysisWorkflow.started[0]?.analysisId).toBe(
      analysisId,
    );
  });

  it("returns 202 with the existing queued run on a re-begin", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, {
      analysisId,
      ingestionId,
      status: "QUEUED",
    });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      run: { status: string };
    };
    expect(body.run.status).toBe("QUEUED");
    expect(harness.rulesAnalysisWorkflow.started).toHaveLength(0);
  });

  it("returns 409 when the current run is already ready", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, {
      analysisId,
      ingestionId,
      status: "READY",
    });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_ALREADY_READY");
  });

  it("invalidates the created run when the workflow start fails", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    seedRulebook(harness, analysisId);
    harness.rulesAnalysisWorkflow.failOnStart = true;
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(BEGIN_BODY),
      }),
      harness.deps,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_STORAGE_UNAVAILABLE");
    const run =
      await harness.rulesAnalysisRunRepository.findCurrent(analysisId);
    expect(run?.status).toBe("INVALIDATED");
  });

  it("rejects an invalid request body", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ characterIntent: {} }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});

describe("rules-context read", () => {
  it("returns 404 when no run exists", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_RUN_NOT_FOUND");
  });

  it("returns 202 with null context while a run is pending", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, { analysisId, ingestionId, status: "RUNNING" });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      run: { status: string };
      context: unknown;
    };
    expect(body.run.status).toBe("RUNNING");
    expect(body.context).toBeNull();
  });

  it("returns 200 with the stored context when ready", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    const run = seedRun(harness, { analysisId, ingestionId, status: "READY" });
    harness.artifactStore.seedContext(run, readyContext(analysisId));
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { status: string };
      context: { status: string } | null;
    };
    expect(body.run.status).toBe("READY");
    expect(body.context?.status).toBe("ready");
  });

  it("returns 500 when the current run failed", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, {
      analysisId,
      ingestionId,
      status: "FAILED",
      failureCode: "RULES_CONTEXT_MODEL_UNAVAILABLE",
    });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_ANALYSIS_FAILED");
  });
});

describe("rules-context confirmation", () => {
  it("only accepts POST", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_CONFIRM_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(404);
  });

  it("rejects a non-JSON confirmation", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const response = await handleRequest(
      new Request(RULES_CONTEXT_CONFIRM_URL(analysisId), {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        body: "not json",
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_INVALID_CONFIRMATION");
  });

  it("rejects confirmation when the run is not in a confirmable state", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, { analysisId, ingestionId, status: "QUEUED" });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_CONFIRM_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: "{}",
      }),
      harness.deps,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(
      "RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID",
    );
  });

  it("returns 409 when the run is already ready", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, { analysisId, ingestionId, status: "READY" });
    const response = await handleRequest(
      new Request(RULES_CONTEXT_CONFIRM_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: "{}",
      }),
      harness.deps,
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULES_CONTEXT_ALREADY_READY");
  });

  it("confirms a conflicts run and resolves its conflicts", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    const run = seedRun(harness, {
      analysisId,
      ingestionId,
      status: "CONFLICTS",
    });
    harness.artifactStore.seedContext(run, conflictsContext(analysisId));
    const response = await handleRequest(
      new Request(RULES_CONTEXT_CONFIRM_URL(analysisId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: "{}",
      }),
      harness.deps,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: { status: string } };
    expect(body.run.status).toBe("CONFIRMED");
    const stored = await harness.artifactStore.getContext(run);
    expect(stored?.status).toBe("ready");
    expect(stored?.conflicts.every((c) => c.status === "resolved")).toBe(true);
  });
});

describe("DELETE rulebook with ready rule-analysis", () => {
  it("invalidates the generation and removes rulebook + vectors + artifacts", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    const run = seedRun(harness, {
      analysisId,
      ingestionId,
      status: "RUNNING",
    });
    harness.artifactStore.seedManifest(run, ["vec-1"]);
    seedRun(harness, {
      analysisId,
      ingestionId,
      status: "FAILED",
      failureCode: "RULES_CONTEXT_ANALYSIS_OUTPUT_INVALID",
    });

    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(204);
    expect(harness.rulebookRepository.rows.has(analysisId)).toBe(false);
    expect(harness.rulesAnalysisRunRepository.rows.get(run.runId)?.status).toBe(
      "INVALIDATED",
    );
    expect(harness.vectorIndex.deleted).toEqual([
      { namespace: ingestionId, ids: ["vec-1"] },
    ]);
    expect(harness.artifactStore.deleted).toContainEqual({
      analysisId,
      ingestionId,
      runId: run.runId,
    });
  });

  it("fails closed with 503 when derived storage is missing for a READY generation", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createSession(harness);
    const { ingestionId } = seedRulebook(harness, analysisId);
    seedRun(harness, { analysisId, ingestionId, status: "READY" });
    delete harness.deps.rulesAnalysisArtifactStore;
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RULEBOOK_STORAGE_UNAVAILABLE");
    expect(harness.rulebookRepository.rows.has(analysisId)).toBe(true);
  });
});
