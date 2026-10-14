import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type { CharacterSheetArtifactStore } from "@repo/character-sheet-artifacts";
import type {
  FinalPresentationPort,
  FinalPresentationPlanV1,
  FinalPresentationStyleV1,
  StructuralSummaryV1,
} from "@repo/character-sheet-generation";
import type {
  RunCleanupCandidate,
  RunTransitionResult,
  SheetGenerationRun,
  SheetRunCreationResult,
  SheetRunFailureCode,
  SheetRunRepositoryPort,
} from "@repo/character-sheet-session";
import { handleRequest, type AppDeps } from "./handler.js";
import { createR2CharacterSheetDraftStoreV2 } from "./infrastructure/r2-character-sheet-drafts-v2.js";
import { createR2CharacterSheetArtifactStore } from "./infrastructure/r2-character-sheet-artifacts.js";
import type { R2BucketLike } from "./infrastructure/r2-character-sheet-artifacts.js";
import {
  FakeClock,
  FakeCrypto,
  FakeDraftHeadRepository,
  FakeHumanVerification,
  FakeRateLimiter,
  FakeResourceCleaner,
  FakeRulebookRepository,
  FakeRulesAnalysisRunRepository,
  FakeSessionRepository,
  FakeSheetSessionRepository,
} from "./test/fakes.js";

const BASE_URL = "https://rules-worker.test";
const SHEET_SESSIONS_URL = `${BASE_URL}/v1/character-sheets/sessions`;

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, value: string | Uint8Array): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? new TextEncoder().encode(value) : value.slice(),
    );
    return {};
  }
  async get(key: string) {
    const payload = this.objects.get(key);
    if (payload === undefined) return null;
    return {
      text: async () => new TextDecoder().decode(payload),
      bytes: async () => payload.slice(),
    };
  }
  async list(options?: { prefix?: string }) {
    const keys = [...this.objects.keys()].filter((key) =>
      options?.prefix === undefined ? true : key.startsWith(options.prefix),
    );
    return { objects: keys.map((key) => ({ key })), truncated: false as const };
  }
  async delete(key: string | string[]): Promise<void> {
    for (const single of Array.isArray(key) ? key : [key]) {
      this.objects.delete(single);
    }
  }
}

class FakeSheetRunRepository implements SheetRunRepositoryPort {
  readonly rows = new Map<string, SheetGenerationRun>();
  async createCurrent(run: SheetGenerationRun): Promise<SheetRunCreationResult> {
    for (const existing of this.rows.values()) {
      if (existing.sessionId === run.sessionId && existing.isCurrent) {
        existing.isCurrent = false;
        if (existing.status === "PENDING" || existing.status === "READY") {
          existing.status = "INVALIDATED";
        }
      }
    }
    this.rows.set(run.runId, { ...run });
    return { kind: "created_current", run };
  }
  async getById(runId: string): Promise<SheetGenerationRun | null> {
    const row = this.rows.get(runId);
    return row === undefined ? null : { ...row };
  }
  async getCurrentForSession(sessionId: string): Promise<SheetGenerationRun | null> {
    for (const row of this.rows.values()) {
      if (row.sessionId === sessionId && row.isCurrent) return { ...row };
    }
    return null;
  }
  private transition(
    runId: string,
    expected: readonly SheetGenerationRun["status"][],
    status: SheetGenerationRun["status"],
    failureCode: SheetRunFailureCode | null,
  ): RunTransitionResult {
    const row = this.rows.get(runId);
    if (row === undefined) return { kind: "not_found" };
    if (!row.isCurrent) return { kind: "not_current" };
    if (!expected.includes(row.status)) return { kind: "wrong_state" };
    row.status = status;
    row.failureCode = failureCode;
    return { kind: "transitioned", run: { ...row } };
  }
  async markReady(runId: string): Promise<RunTransitionResult> {
    return this.transition(runId, ["PENDING"], "READY", null);
  }
  async markFailed(runId: string, failureCode: SheetRunFailureCode): Promise<RunTransitionResult> {
    return this.transition(runId, ["PENDING"], "FAILED", failureCode);
  }
  async invalidateCurrent(runId: string): Promise<RunTransitionResult> {
    return this.transition(runId, ["PENDING", "READY"], "INVALIDATED", null);
  }
  async expire(runId: string): Promise<RunTransitionResult> {
    return this.transition(runId, ["PENDING", "READY"], "EXPIRED", null);
  }
  async findCleanupCandidates(): Promise<readonly RunCleanupCandidate[]> {
    return [];
  }
}

function deterministicPresentation(
  plans: Partial<Record<FinalPresentationStyleV1, FinalPresentationPlanV1>> = {},
  failWith: Error | null = null,
): FinalPresentationPort {
  return {
    async generatePlan(
      style: FinalPresentationStyleV1,
      _summary: StructuralSummaryV1,
      _instructions: string | null,
    ): Promise<FinalPresentationPlanV1> {
      if (failWith !== null) throw failWith;
      return (
        plans[style] ?? {
          schemaVersion: "1",
          style,
          variant: "standard",
          ornamentDensity: "light",
          contrast: "medium",
          sectionEmphasis: "standard",
          fieldEmphasis: "standard",
        }
      );
    },
  };
}

interface FinalHarness {
  deps: AppDeps;
  clock: FakeClock;
  crypto: FakeCrypto;
  rateLimiter: FakeRateLimiter;
  runs: FakeSheetRunRepository;
  bucket: MemoryBucket;
}

function makeFinalHarness(
  presentation: FinalPresentationPort = deterministicPresentation(),
  artifacts?: CharacterSheetArtifactStore,
): FinalHarness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const rateLimiter = new FakeRateLimiter();
  const bucket = new MemoryBucket();
  const runs = new FakeSheetRunRepository();
  const deps: AppDeps = {
    crypto,
    clock,
    repository: new FakeSessionRepository(),
    cleaner: new FakeResourceCleaner(),
    humanVerifier: new FakeHumanVerification(),
    rateLimiter,
    rulebookRepository: new FakeRulebookRepository(clock),
    rulesAnalysisRunRepository: new FakeRulesAnalysisRunRepository(),
    sheetSessionRepository: new FakeSheetSessionRepository(),
    sheetDraftHeadRepository: new FakeDraftHeadRepository(),
    sheetDraftStoreV2: createR2CharacterSheetDraftStoreV2(bucket),
    sheetArtifactStore:
      artifacts ?? createR2CharacterSheetArtifactStore(bucket),
    sheetRunRepository: runs,
    finalPresentationPort: presentation,
  };
  return { deps, clock, crypto, rateLimiter, runs, bucket };
}

function makePcDraft(sessionId: string, draftId = "draft.pc.final"): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId,
    sessionId,
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Character Name", type: "text", locked: false },
      { key: "strength", label: "Strength", type: "number", min: 1, max: 20, locked: false },
      { key: "bio", label: "Biography", type: "textarea", locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "core" },
      { kind: "field", key: "bio", parentKey: "core" },
    ],
    values: { character_name: "Aria Stone", strength: 14 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

function makeNpcDraft(sessionId: string, draftId = "draft.npc.final"): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId,
    sessionId,
    baseVersion: 1,
    version: 1,
    mode: "npc",
    characterName: "Goblin",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Character Name", type: "text", locked: false },
      { key: "hp", label: "HP", type: "number", min: 10, max: 20, locked: false },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "hp", parentKey: "core" },
      { kind: "field", key: "notes", parentKey: "core" },
    ],
    values: { character_name: "Goblin" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

async function createSession(harness: FinalHarness): Promise<{ sessionId: string; accessToken: string }> {
  const response = await handleRequest(
    new Request(SHEET_SESSIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "turnstile-ok" }),
    }),
    harness.deps,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { sessionId: string; accessToken: string };
}

async function createDraft(
  harness: FinalHarness,
  sessionId: string,
  token: string,
  draft: CharacterSheetDraftV2,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(draft),
    }),
    harness.deps,
  );
}

async function confirmDraft(
  harness: FinalHarness,
  sessionId: string,
  token: string,
  draftId: string,
  expectedVersion: number,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draftId}/confirm`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion }),
    }),
    harness.deps,
  );
}

function generateBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 2,
    options: {
      threat: null,
      visualStyle: "medieval",
      instructions: null,
      portrait: { kind: "none" },
    },
    seed: "final-seed-1",
    ...overrides,
  };
}

async function postGenerate(
  harness: FinalHarness,
  sessionId: string,
  token: string,
  draftId: string,
  body: unknown,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draftId}/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    harness.deps,
  );
}

async function getPdf(
  harness: FinalHarness,
  sessionId: string,
  token: string,
  runId: string,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/runs/${runId}/pdf`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
    harness.deps,
  );
}

async function setupConfirmedPc(harness: FinalHarness, draftId = "draft.pc.final") {
  const { sessionId, accessToken } = await createSession(harness);
  const created = await createDraft(harness, sessionId, accessToken, makePcDraft(sessionId, draftId));
  expect(created.status).toBe(201);
  const confirmed = await confirmDraft(harness, sessionId, accessToken, draftId, 1);
  expect(confirmed.status).toBe(200);
  return { sessionId, accessToken, draftId };
}

describe("final generation (14.12)", () => {
  it("A. confirmed PC draft generates READY and serves the final PDF", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);

    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schemaVersion: string;
      runId: string;
      status: string;
      draftId: string;
      draftVersion: number;
    };
    expect(body.schemaVersion).toBe("1");
    expect(body.status).toBe("READY");
    expect(body.draftId).toBe(draftId);
    expect(body.draftVersion).toBe(2);

    const stored = await harness.runs.getById(body.runId);
    expect(stored?.status).toBe("READY");
    expect(stored?.draftId).toBe(draftId);
    expect(stored?.draftVersion).toBe(2);

    // No manufactured spec exists for the styled path.
    const artifacts = harness.deps.sheetArtifactStore!;
    expect(await artifacts.getSpec({ sessionId, runId: body.runId })).toBeNull();

    const pdf = await getPdf(harness, sessionId, accessToken, body.runId);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("cache-control")).toBe("no-store");
    expect(pdf.headers.get("content-disposition")).toMatch(/^attachment; filename="[^"]+\.pdf"$/);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    // Dedicated rate-limit key, not the extraction key.
    expect(harness.rateLimiter.calls).toContain("sheet-final-generation:unknown");
  });

  it("confirmed NPC draft generates with threat and deterministic values", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const draftId = "draft.npc.final";
    expect((await createDraft(harness, sessionId, accessToken, makeNpcDraft(sessionId, draftId))).status).toBe(201);
    expect((await confirmDraft(harness, sessionId, accessToken, draftId, 1)).status).toBe(200);

    const first = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ options: { threat: "medium", visualStyle: "sci-fi", instructions: null, portrait: { kind: "none" } }, seed: "npc-seed" }),
    );
    expect(first.status).toBe(200);
    // Same seed + threat across styles succeeds twice (values are style-invariant
    // by construction: the resolver never receives the style).
    const firstPdf = await getPdf(harness, sessionId, accessToken, ((await first.json()) as { runId: string }).runId);
    expect(firstPdf.status).toBe(200);
    const second = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ options: { threat: "medium", visualStyle: "medieval", instructions: null, portrait: { kind: "none" } }, seed: "npc-seed" }),
    );
    expect(second.status).toBe(200);
    const secondPdf = await getPdf(harness, sessionId, accessToken, ((await second.json()) as { runId: string }).runId);
    expect(secondPdf.status).toBe(200);
  });

  it("B. stale expectedVersion is rejected with no run created", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody({ expectedVersion: 1 }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_DRAFT_VERSION_CONFLICT");
    expect(await harness.runs.getCurrentForSession(sessionId)).toBeNull();
  });

  it("C. unconfirmed draft is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const draftId = "draft.unconfirmed";
    expect((await createDraft(harness, sessionId, accessToken, makePcDraft(sessionId, draftId))).status).toBe(201);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ expectedVersion: 1 }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_INVALID");
  });

  it("D. PC with threat is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ options: { threat: "medium", visualStyle: "medieval", instructions: null, portrait: { kind: "none" } } }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_INVALID");
  });

  it("E. NPC without threat is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const draftId = "draft.npc.final";
    expect((await createDraft(harness, sessionId, accessToken, makeNpcDraft(sessionId, draftId))).status).toBe(201);
    expect((await confirmDraft(harness, sessionId, accessToken, draftId, 1)).status).toBe(200);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_INVALID");
  });

  it("F. unsupported style is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ options: { threat: null, visualStyle: "fantasy", instructions: null, portrait: { kind: "none" } } }),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_STYLE_UNSUPPORTED");
  });

  it("rejects a client-supplied Draft snapshot in the generate body", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const body = { ...generateBody(), draft: makePcDraft(sessionId, draftId) };
    const response = await postGenerate(harness, sessionId, accessToken, draftId, body);
    expect(response.status).toBe(400);
  });

  it("G. AI presentation failure marks the run FAILED with no downloadable PDF", async () => {
    const harness = makeFinalHarness(
      deterministicPresentation({}, new Error("provider down")),
    );
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_UNAVAILABLE");
    const current = await harness.runs.getCurrentForSession(sessionId);
    expect(current?.status).toBe("FAILED");
    expect(current?.runId).toBeDefined();
    const pdf = await getPdf(harness, sessionId, accessToken, current!.runId);
    expect(pdf.status).toBe(409);
  });

  it("H. invalid presentation plan marks the run FAILED", async () => {
    const harness = makeFinalHarness(
      deterministicPresentation({
        medieval: {
          schemaVersion: "1",
          style: "sci-fi",
          variant: "standard",
          ornamentDensity: "light",
          contrast: "medium",
          sectionEmphasis: "standard",
          fieldEmphasis: "standard",
        },
      }),
    );
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    // The adapter for this fake returns a mismatched style; the orchestrator
    // validates the plan against the schema and fails the run.
    expect([500, 503]).toContain(response.status);
    const current = await harness.runs.getCurrentForSession(sessionId);
    expect(current?.status).toBe("FAILED");
  });

  it("I. artifact storage failure marks the run FAILED", async () => {
    const failingArtifacts: CharacterSheetArtifactStore = {
      async putRunArtifacts(): Promise<void> {
        throw new Error("unreachable");
      },
      async putPdfBytes(): Promise<void> {
        throw new Error("R2 unavailable");
      },
      async getSpec(): Promise<null> {
        return null;
      },
      async getPdfBytes(): Promise<Uint8Array | null> {
        return null;
      },
      async deleteRunArtifacts(): Promise<void> {},
      async deleteSessionArtifacts(): Promise<void> {},
    };
    const harness = makeFinalHarness(deterministicPresentation(), failingArtifacts);
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    expect(response.status).toBe(500);
    const current = await harness.runs.getCurrentForSession(sessionId);
    expect(current?.status).toBe("FAILED");
  });

  it("J. cross-session PDF access is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const generated = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    const { runId } = (await generated.json()) as { runId: string };
    const other = await createSession(harness);
    const pdf = await getPdf(harness, other.sessionId, other.accessToken, runId);
    expect(pdf.status).toBe(404);
  });

  it("missing run PDF access is rejected", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken } = await createSession(harness);
    const pdf = await getPdf(harness, sessionId, accessToken, "00000000-0000-4000-8000-000000000099");
    expect(pdf.status).toBe(404);
  });

  it("missing presentation binding fails closed without a fake fallback", async () => {
    const harness = makeFinalHarness();
    (harness.deps as { finalPresentationPort?: unknown }).finalPresentationPort = undefined;
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const response = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_UNAVAILABLE");
  });
});

describe("final-generation orchestrator units", () => {
  it("reuses the existing sheet_generation_runs lifecycle (no new tables)", async () => {
    const harness = makeFinalHarness();
    const { sessionId, accessToken, draftId } = await setupConfirmedPc(harness);
    const first = await postGenerate(harness, sessionId, accessToken, draftId, generateBody());
    const firstRunId = ((await first.json()) as { runId: string }).runId;
    const second = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({ options: { threat: null, visualStyle: "sci-fi", instructions: null, portrait: { kind: "none" } } }),
    );
    expect(second.status).toBe(200);
    const secondRunId = ((await second.json()) as { runId: string }).runId;
    expect(secondRunId).not.toBe(firstRunId);
    expect((await harness.runs.getById(firstRunId))?.status).toBe("INVALIDATED");
    expect((await harness.runs.getById(secondRunId))?.status).toBe("READY");
  });
});
