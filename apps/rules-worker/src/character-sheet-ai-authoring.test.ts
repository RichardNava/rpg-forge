import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type { CharacterSheetArtifactStore } from "@repo/character-sheet-artifacts";
import type {
  AiDraftCreationPort,
  AiDraftProposalV1,
  FinalPresentationPort,
  FinalPresentationPlanV1,
  FinalPresentationStyleV1,
  NpcValueAuthoringPort,
  NpcValueAuthoringPlanV1,
  StructuralSummaryV1,
} from "@repo/character-sheet-generation";
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
import type { SheetRunRepositoryPort } from "@repo/character-sheet-session";

const BASE_URL = "https://rules-worker.test";
const SHEET_SESSIONS_URL = `${BASE_URL}/v1/character-sheets/sessions`;

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, value: string | Uint8Array): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value.slice(),
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
  readonly rows = new Map<
    string,
    import("@repo/character-sheet-session").SheetGenerationRun
  >();
  async createCurrent(
    run: import("@repo/character-sheet-session").SheetGenerationRun,
  ): Promise<import("@repo/character-sheet-session").SheetRunCreationResult> {
    this.rows.set(run.runId, { ...run });
    return { kind: "created_current", run };
  }
  async getById(runId: string) {
    const row = this.rows.get(runId);
    return row === undefined ? null : { ...row };
  }
  async getCurrentForSession() {
    return null;
  }
  private transition(
    runId: string,
    status: "READY" | "FAILED",
    failureCode:
      import("@repo/character-sheet-session").SheetRunFailureCode | null,
  ): import("@repo/character-sheet-session").RunTransitionResult {
    const row = this.rows.get(runId);
    if (row === undefined) return { kind: "not_found" };
    row.status = status;
    row.failureCode = failureCode;
    return { kind: "transitioned", run: { ...row } };
  }
  async markReady(runId: string) {
    return this.transition(runId, "READY", null);
  }
  async markFailed(
    runId: string,
    failureCode: import("@repo/character-sheet-session").SheetRunFailureCode,
  ) {
    return this.transition(runId, "FAILED", failureCode);
  }
  async invalidateCurrent() {
    return { kind: "not_current" as const };
  }
  async expire() {
    return { kind: "not_current" as const };
  }
  async findCleanupCandidates() {
    return [];
  }
}

function deterministicPresentation(
  seen: Array<{ style: string; instructions: string | null }> = [],
): FinalPresentationPort {
  return {
    async generatePlan(
      style: FinalPresentationStyleV1,
      _summary: StructuralSummaryV1,
      instructions: string | null,
    ): Promise<FinalPresentationPlanV1> {
      seen.push({ style, instructions });
      return {
        schemaVersion: "1",
        style,
        variant: "standard",
        ornamentDensity: "light",
        contrast: "medium",
        sectionEmphasis: "standard",
        fieldEmphasis: "standard",
      };
    },
  };
}

function recordingAuthoring(
  seen: unknown[],
  plan: NpcValueAuthoringPlanV1 | null,
  failWith: Error | null = null,
): NpcValueAuthoringPort {
  return {
    async generateAssignments(input: {
      blanks: readonly unknown[];
      explicit: readonly unknown[];
      npcInstructions: string;
      threat: unknown;
      seed: string;
    }): Promise<NpcValueAuthoringPlanV1> {
      seen.push(input);
      if (failWith !== null) throw failWith;
      if (plan === null) throw new Error("no plan configured");
      return plan;
    },
  };
}

function recordingCreation(
  seen: unknown[],
  proposal: AiDraftProposalV1 | null,
  failWith: Error | null = null,
): AiDraftCreationPort {
  return {
    async createProposal(input: {
      mode: "pc" | "npc";
      prompt: string;
    }): Promise<AiDraftProposalV1> {
      seen.push(input);
      if (failWith !== null) throw failWith;
      if (proposal === null) throw new Error("no proposal configured");
      return proposal;
    },
  };
}

interface AuthoringHarness {
  deps: AppDeps;
  rateLimiter: FakeRateLimiter;
  runs: FakeSheetRunRepository;
  authoringSeen: unknown[];
  presentationSeen: Array<{ style: string; instructions: string | null }>;
  creationSeen: unknown[];
}

function makeAuthoringHarness(options?: {
  authoringPlan?: NpcValueAuthoringPlanV1 | null;
  authoringError?: Error | null;
  creationProposal?: AiDraftProposalV1 | null;
  creationError?: Error | null;
}): AuthoringHarness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const rateLimiter = new FakeRateLimiter();
  const bucket = new MemoryBucket();
  const runs = new FakeSheetRunRepository();
  const authoringSeen: unknown[] = [];
  const presentationSeen: Array<{
    style: string;
    instructions: string | null;
  }> = [];
  const creationSeen: unknown[] = [];
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
    sheetArtifactStore: createR2CharacterSheetArtifactStore(bucket),
    sheetRunRepository: runs,
    finalPresentationPort: deterministicPresentation(presentationSeen),
  };
  if (
    options?.authoringPlan !== undefined ||
    options?.authoringError !== undefined
  ) {
    (deps as { npcAuthoringPort?: NpcValueAuthoringPort }).npcAuthoringPort =
      recordingAuthoring(
        authoringSeen,
        options.authoringPlan ?? null,
        options.authoringError ?? null,
      );
  }
  if (
    options?.creationProposal !== undefined ||
    options?.creationError !== undefined
  ) {
    (
      deps as { aiDraftCreationPort?: AiDraftCreationPort }
    ).aiDraftCreationPort = recordingCreation(
      creationSeen,
      options.creationProposal ?? null,
      options.creationError ?? null,
    );
  }
  return {
    deps,
    rateLimiter,
    runs,
    authoringSeen,
    presentationSeen,
    creationSeen,
  };
}

function makeNpcDraft(
  sessionId: string,
  draftId = "draft.npc.authoring",
): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId,
    sessionId,
    baseVersion: 1,
    version: 1,
    mode: "npc",
    characterName: "Grom",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character Name",
        type: "text",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 10,
        locked: false,
      },
      {
        key: "hp",
        label: "HP",
        type: "number",
        min: 10,
        max: 20,
        locked: false,
      },
      { key: "notes", label: "Notes", type: "textarea", locked: false },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "core" },
      { kind: "field", key: "hp", parentKey: "core" },
      { kind: "field", key: "notes", parentKey: "core" },
    ],
    values: { character_name: "Grom", strength: 4 },
    source: { sourceSheetId: null, sourceRunId: null },
    confirmed: false,
  };
}

async function createSession(harness: AuthoringHarness) {
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

async function setupConfirmedNpc(
  harness: AuthoringHarness,
  draftId = "draft.npc.authoring",
) {
  const { sessionId, accessToken } = await createSession(harness);
  const created = await handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(makeNpcDraft(sessionId, draftId)),
    }),
    harness.deps,
  );
  expect(created.status).toBe(201);
  const confirmed = await handleRequest(
    new Request(
      `${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draftId}/confirm`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      },
    ),
    harness.deps,
  );
  expect(confirmed.status).toBe(200);
  return { sessionId, accessToken, draftId };
}

function generateBody(overrides: Record<string, unknown> = {}) {
  return {
    expectedVersion: 2,
    options: {
      threat: "medium",
      visualStyle: "medieval",
      instructions: null,
      npcInstructions: null,
      portrait: { kind: "none" },
    },
    seed: "authoring-seed-1",
    ...overrides,
  };
}

async function postGenerate(
  harness: AuthoringHarness,
  sessionId: string,
  token: string,
  draftId: string,
  body: unknown,
) {
  return handleRequest(
    new Request(
      `${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draftId}/generate`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ),
    harness.deps,
  );
}

const AI_PLAN: NpcValueAuthoringPlanV1 = {
  schemaVersion: "1",
  assignments: [{ key: "notes", value: "Large and clumsy." }],
};

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const AI_PROPOSAL: AiDraftProposalV1 = {
  schemaVersion: "1",
  characterName: "Grom",
  sections: [{ id: "core", title: "Core", parentId: null }],
  fields: [
    { id: "character_name", label: "Character name", type: "text" },
    {
      id: "strength",
      label: "Strength",
      type: "number",
      min: 1,
      max: 10,
      value: 8,
    },
  ],
  structure: [
    { kind: "field", id: "character_name", parentId: null },
    { kind: "section", id: "core", parentId: null },
    { kind: "field", id: "strength", parentId: "core" },
  ],
};

async function postGenerateAi(
  harness: AuthoringHarness,
  sessionId: string,
  token: string,
  body: unknown,
) {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts/generate-ai`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    harness.deps,
  );
}

describe("AI draft creation route (14.14)", () => {
  it("creates an editable unconfirmed canonical draft through the normal path", async () => {
    const harness = makeAuthoringHarness({ creationProposal: AI_PROPOSAL });
    const { sessionId, accessToken } = await createSession(harness);
    const response = await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "npc",
      prompt: "A large orc.",
    });
    expect(response.status).toBe(201);
    const draft = (await response.json()) as CharacterSheetDraftV2;
    expect(draft.schemaVersion).toBe("2");
    expect(draft.mode).toBe("npc");
    expect(draft.confirmed).toBe(false);
    expect(draft.version).toBe(1);
    expect(draft.baseVersion).toBe(1);
    expect(draft.sessionId).toBe(sessionId);
    expect(draft.characterName).toBe("Grom");
    expect(harness.creationSeen).toEqual([
      { mode: "npc", prompt: "A large orc." },
    ]);
    // No final-generation run was created.
    expect(harness.runs.rows.size).toBe(0);

    // The draft lives the ordinary lifecycle: GET, PATCH, confirm.
    const fetched = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draft.draftId}`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
        },
      ),
      harness.deps,
    );
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as CharacterSheetDraftV2).draftId).toBe(
      draft.draftId,
    );
    const patched = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draft.draftId}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedVersion: 1,
            mutation: { op: "set_value", key: "proposal_strength", value: 9 },
          }),
        },
      ),
      harness.deps,
    );
    expect(patched.status).toBe(200);
    const confirmed = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draft.draftId}/confirm`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expectedVersion: 2 }),
        },
      ),
      harness.deps,
    );
    expect(confirmed.status).toBe(200);
  });

  it("preserves the requested PC mode", async () => {
    const harness = makeAuthoringHarness({ creationProposal: AI_PROPOSAL });
    const { sessionId, accessToken } = await createSession(harness);
    const response = await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "pc",
      prompt: "A scout.",
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as CharacterSheetDraftV2).mode).toBe("pc");
  });

  it("rejects unauthorized sessions, invalid requests, and missing AI", async () => {
    const harness = makeAuthoringHarness({ creationProposal: AI_PROPOSAL });
    const { sessionId, accessToken } = await createSession(harness);
    const unauthorized = await postGenerateAi(harness, sessionId, "bad-token", {
      schemaVersion: "1",
      mode: "npc",
      prompt: "x",
    });
    expect(unauthorized.status).toBe(404);

    const invalid = await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "npc",
      prompt: "   ",
    });
    expect(invalid.status).toBe(400);

    const noAi = makeAuthoringHarness();
    const setup = await createSession(noAi);
    const unavailable = await postGenerateAi(
      noAi,
      setup.sessionId,
      setup.accessToken,
      {
        schemaVersion: "1",
        mode: "npc",
        prompt: "A large orc.",
      },
    );
    expect(unavailable.status).toBe(503);
  });

  it("keys AI rate limits by session and throttles draft writes", async () => {
    const harness = makeAuthoringHarness({ creationProposal: AI_PROPOSAL });
    const { sessionId, accessToken } = await createSession(harness);
    await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "npc",
      prompt: "A large orc.",
    });
    expect(
      harness.rateLimiter.calls.some(
        (key) => key === `sheet-ai-draft:${sessionId}`,
      ),
    ).toBe(true);

    // Draft writes consume a dedicated session-scoped bucket.
    const draftId = "draft.write.limit";
    const created = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(makeNpcDraft(sessionId, draftId)),
      }),
      harness.deps,
    );
    expect(created.status).toBe(201);
    expect(
      harness.rateLimiter.calls.some(
        (key) => key === `sheet-draft-write:${sessionId}`,
      ),
    ).toBe(true);

    // A denied write bucket rejects the mutation before any work happens.
    harness.rateLimiter.result = { kind: "denied" };
    const denied = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts/${draftId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: 1,
          mutation: { op: "set_value", key: "notes", value: "x" },
        }),
      }),
      harness.deps,
    );
    expect(denied.status).toBe(429);
  });

  it("maps invalid proposals to a typed failure and enforces the rate limit", async () => {
    const harness = makeAuthoringHarness({
      creationProposal: {
        schemaVersion: "1",
        characterName: null,
        sections: [],
        fields: [],
        structure: [],
      },
    });
    const { sessionId, accessToken } = await createSession(harness);
    const failed = await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "npc",
      prompt: "A large orc.",
    });
    expect(failed.status).toBe(500);
    const body = (await failed.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_AI_DRAFT_FAILED");

    harness.rateLimiter.result = { kind: "denied" };
    const limited = await postGenerateAi(harness, sessionId, accessToken, {
      schemaVersion: "1",
      mode: "npc",
      prompt: "A large orc.",
    });
    expect(limited.status).toBe(429);
    expect(
      harness.rateLimiter.calls.some((key) =>
        key.startsWith("sheet-ai-draft:"),
      ),
    ).toBe(true);
  });
});

describe("final generation with NPC authoring instructions (14.14)", () => {
  it("NPC with instructions calls the authoring port once with style-free input", async () => {
    const harness = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const { sessionId, accessToken, draftId } =
      await setupConfirmedNpc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "Big and clumsy.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(harness.authoringSeen).toHaveLength(1);
    const input = harness.authoringSeen[0] as Record<string, unknown>;
    expect(input["npcInstructions"]).toBe("Big and clumsy.");
    expect(input["threat"]).toBe("medium");
    expect(input["seed"]).toBe("authoring-seed-1");
    expect("visualStyle" in input).toBe(false);
    expect("style" in input).toBe(false);
    const blanks = input["blanks"] as Array<{ key: string }>;
    expect(blanks.map((blank) => blank.key).sort()).toEqual(["hp", "notes"]);
    const runId = ((await response.json()) as { runId: string }).runId;
    expect((await harness.runs.getById(runId))?.status).toBe("READY");
  });

  it("validated AI assignments reach the final PDF; threat still fills the rest", async () => {
    // Same draft, seed, and style: the ONLY variable is the authoring call.
    // Different PDF bytes prove the AI assignments flowed into the render.
    // (Value-level mapping assignments -> resolved values is proven in domain
    // tests; resolved values -> PDF form fields in renderer tests.)
    const optionsWithAi = {
      threat: "medium",
      visualStyle: "medieval",
      instructions: null,
      npcInstructions: "Big and clumsy.",
      portrait: { kind: "none" },
    };
    const withAi = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const first = await setupConfirmedNpc(withAi);
    const aiResponse = await postGenerate(
      withAi,
      first.sessionId,
      first.accessToken,
      first.draftId,
      generateBody({ options: optionsWithAi }),
    );
    expect(aiResponse.status).toBe(200);
    const aiRunId = ((await aiResponse.json()) as { runId: string }).runId;
    const aiPdf = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${first.sessionId}/runs/${aiRunId}/pdf`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${first.accessToken}` },
        },
      ),
      withAi.deps,
    );
    expect(aiPdf.status).toBe(200);

    const withoutAi = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const second = await setupConfirmedNpc(withoutAi);
    const plainResponse = await postGenerate(
      withoutAi,
      second.sessionId,
      second.accessToken,
      second.draftId,
      generateBody(),
    );
    expect(plainResponse.status).toBe(200);
    const plainRunId = ((await plainResponse.json()) as { runId: string })
      .runId;
    const plainPdf = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${second.sessionId}/runs/${plainRunId}/pdf`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${second.accessToken}` },
        },
      ),
      withoutAi.deps,
    );
    expect(plainPdf.status).toBe(200);
    const aiBytes = new Uint8Array(await aiPdf.arrayBuffer());
    const plainBytes = new Uint8Array(await plainPdf.arrayBuffer());
    expect(bytesEqual(aiBytes, plainBytes)).toBe(false);
  });

  it("NPC without instructions never calls the authoring port (14.12 behavior)", async () => {
    const harness = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const { sessionId, accessToken, draftId } =
      await setupConfirmedNpc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody(),
    );
    expect(response.status).toBe(200);
    expect(harness.authoringSeen).toHaveLength(0);
  });

  it("PC with npcInstructions is rejected before any model call", async () => {
    const harness = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const { sessionId, accessToken } = await createSession(harness);
    const draft = {
      ...makeNpcDraft(sessionId, "draft.pc.authoring"),
      mode: "pc" as const,
    };
    const created = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(draft),
      }),
      harness.deps,
    );
    expect(created.status).toBe(201);
    await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/drafts/draft.pc.authoring/confirm`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expectedVersion: 1 }),
        },
      ),
      harness.deps,
    );
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      "draft.pc.authoring",
      {
        expectedVersion: 2,
        options: {
          threat: null,
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "make it strong",
          portrait: { kind: "none" },
        },
        seed: "authoring-seed-1",
      },
    );
    expect(response.status).toBe(422);
    expect(harness.authoringSeen).toHaveLength(0);
    expect(harness.presentationSeen).toHaveLength(0);
  });

  it("explicit values win: conflicting AI assignment fails the run with no PDF", async () => {
    const harness = makeAuthoringHarness({
      authoringPlan: {
        schemaVersion: "1",
        assignments: [{ key: "strength", value: 9 }],
      },
    });
    const { sessionId, accessToken, draftId } =
      await setupConfirmedNpc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "Strong.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_FINAL_GENERATION_FAILED");
  });

  it("unavailable authoring AI fails the run with no PDF (never silent threat fallback)", async () => {
    const harness = makeAuthoringHarness();
    const { sessionId, accessToken, draftId } =
      await setupConfirmedNpc(harness);
    const response = await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "Big.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(response.status).toBe(503);
    const runs = [...harness.runs.rows.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("FAILED");
    const pdf = await handleRequest(
      new Request(
        `${SHEET_SESSIONS_URL}/${sessionId}/runs/${runs[0]?.runId ?? "missing"}/pdf`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
        },
      ),
      harness.deps,
    );
    expect(pdf.status).not.toBe(200);
  });

  it("provider failure and invalid plans fail the run", async () => {
    const failing = makeAuthoringHarness({ authoringError: new Error("down") });
    const first = await setupConfirmedNpc(failing);
    const downResponse = await postGenerate(
      failing,
      first.sessionId,
      first.accessToken,
      first.draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "Big.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(downResponse.status).toBe(503);

    const invalid = makeAuthoringHarness({
      authoringPlan: {
        schemaVersion: "1",
        assignments: [{ key: "unknown_key", value: "x" }],
      },
    });
    const second = await setupConfirmedNpc(invalid);
    const invalidResponse = await postGenerate(
      invalid,
      second.sessionId,
      second.accessToken,
      second.draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "medieval",
          instructions: null,
          npcInstructions: "Big.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(invalidResponse.status).toBe(500);
  });

  it("presentation AI stays separate: instructions travel, npcInstructions do not", async () => {
    const harness = makeAuthoringHarness({ authoringPlan: AI_PLAN });
    const { sessionId, accessToken, draftId } =
      await setupConfirmedNpc(harness);
    await postGenerate(
      harness,
      sessionId,
      accessToken,
      draftId,
      generateBody({
        options: {
          threat: "medium",
          visualStyle: "sci-fi",
          instructions: "Keep it restrained.",
          npcInstructions: "Big and clumsy.",
          portrait: { kind: "none" },
        },
      }),
    );
    expect(harness.presentationSeen).toHaveLength(1);
    expect(harness.presentationSeen[0]).toEqual({
      style: "sci-fi",
      instructions: "Keep it restrained.",
    });
  });

  it("style-invariance: identical authoring input across styles; presentation differs", async () => {
    // The recorded authoring inputs must be deep-equal across styles (style
    // never enters content authoring). Resolved-value equality across styles
    // is proven in domain tests (the resolver takes no style) and renderer
    // manifest tests; here both runs must be READY with distinct bytes.
    async function runWithStyle(style: string) {
      const harness = makeAuthoringHarness({ authoringPlan: AI_PLAN });
      const setup = await setupConfirmedNpc(harness);
      const response = await postGenerate(
        harness,
        setup.sessionId,
        setup.accessToken,
        setup.draftId,
        generateBody({
          options: {
            threat: "medium",
            visualStyle: style,
            instructions: null,
            npcInstructions: "Big and clumsy.",
            portrait: { kind: "none" },
          },
        }),
      );
      expect(response.status).toBe(200);
      const runId = ((await response.json()) as { runId: string }).runId;
      const pdf = await handleRequest(
        new Request(
          `${SHEET_SESSIONS_URL}/${setup.sessionId}/runs/${runId}/pdf`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${setup.accessToken}` },
          },
        ),
        harness.deps,
      );
      expect(pdf.status).toBe(200);
      return {
        authoringInput: harness.authoringSeen[0],
        bytes: new Uint8Array(await pdf.arrayBuffer()),
      };
    }
    const medieval = await runWithStyle("medieval");
    const scifi = await runWithStyle("sci-fi");
    expect(medieval.authoringInput).toEqual(scifi.authoringInput);
    expect(bytesEqual(medieval.bytes, scifi.bytes)).toBe(false);
  });
});
