import { describe, expect, it } from "vitest";
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  draftError,
  getDraftSnapshotKey,
  type CharacterSheetDraftV2,
  type DraftErrorCode,
} from "@repo/character-sheet-draft";
import { handleRequest, type AppDeps } from "./handler.js";
import type { R2BucketLike } from "./infrastructure/r2-character-sheet-artifacts.js";
import { createR2CharacterSheetDraftStoreV2 } from "./infrastructure/r2-character-sheet-drafts-v2.js";
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

/**
 * Deterministic in-memory bucket for the live V2 store adapter. Conditional
 * creates (`If-None-Match: *`) are honored atomically so duplicate-create and
 * orphan-recovery behavior is covered as it actually behaves.
 */
class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, string>();
  readonly putKeys: string[] = [];
  failNextPut = false;
  failNextGet = false;

  seed(key: string, payload: string): void {
    this.objects.set(key, payload);
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options?: {
      onlyIf?: Headers;
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<unknown> {
    this.putKeys.push(key);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("r2 put unavailable");
    }
    if (options?.onlyIf?.get("If-None-Match") === "*") {
      if (this.objects.has(key)) {
        return null;
      }
    }
    this.objects.set(
      key,
      typeof value === "string" ? value : new TextDecoder().decode(value),
    );
    return {};
  }

  async get(key: string): Promise<{
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
  } | null> {
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("r2 get unavailable");
    }
    const payload = this.objects.get(key);
    if (payload === undefined) return null;
    return {
      text: async () => payload,
      bytes: async () => new TextEncoder().encode(payload),
    };
  }

  async list(): Promise<{ objects: { key: string }[]; truncated: boolean }> {
    return {
      objects: [...this.objects.keys()].map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(key: string | string[]): Promise<void> {
    for (const single of Array.isArray(key) ? key : [key]) {
      this.objects.delete(single);
    }
  }
}

interface Harness {
  deps: AppDeps;
  clock: FakeClock;
  crypto: FakeCrypto;
  rateLimiter: FakeRateLimiter;
  humanVerifier: FakeHumanVerification;
  sheetSessions: FakeSheetSessionRepository;
  draftHeads: FakeDraftHeadRepository;
  draftStore: {
    failOnPutDraft: boolean;
    failOnGetDraftVersion: DraftErrorCode | null;
    getDraftVersion(
      identity: { sessionId: string; draftId: string },
      version: number,
    ): Promise<CharacterSheetDraftV2 | null>;
  };
  bucket: MemoryBucket;
}

function makeHarness(): Harness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const rateLimiter = new FakeRateLimiter();
  const humanVerifier = new FakeHumanVerification();
  const sheetSessions = new FakeSheetSessionRepository();
  const draftHeads = new FakeDraftHeadRepository();
  const bucket = new MemoryBucket();
  const store = createR2CharacterSheetDraftStoreV2(bucket);
  const draftStore = {
    failOnPutDraft: false,
    failOnGetDraftVersion: null as DraftErrorCode | null,
    async getDraftVersion(
      identity: { sessionId: string; draftId: string },
      version: number,
    ): Promise<CharacterSheetDraftV2 | null> {
      return store.getDraftVersion(identity, version);
    },
  };
  const deps: AppDeps = {
    crypto,
    clock,
    repository: new FakeSessionRepository(),
    cleaner: new FakeResourceCleaner(),
    humanVerifier,
    rateLimiter,
    rulebookRepository: new FakeRulebookRepository(clock),
    rulesAnalysisRunRepository: new FakeRulesAnalysisRunRepository(),
    sheetSessionRepository: sheetSessions,
    sheetDraftHeadRepository: draftHeads,
    sheetDraftStoreV2: {
      putInitialDraftIfAbsent: (draft) => store.putInitialDraftIfAbsent(draft),
      putDraft: async (draft) => {
        if (draftStore.failOnPutDraft) {
          throw new Error("draft snapshot write failed");
        }
        return store.putDraft(draft);
      },
      getDraftVersion: async (identity, version) => {
        if (draftStore.failOnGetDraftVersion !== null) {
          throw draftError(
            draftStore.failOnGetDraftVersion,
            "Injected read failure.",
          );
        }
        return store.getDraftVersion(identity, version);
      },
      getLatestDraft: (identity) => store.getLatestDraft(identity),
      listDraftVersions: (identity) => store.listDraftVersions(identity),
      deleteDraft: (identity) => store.deleteDraft(identity),
    },
  };
  return {
    deps,
    clock,
    crypto,
    rateLimiter,
    humanVerifier,
    sheetSessions,
    draftHeads,
    draftStore,
    bucket,
  };
}

interface ErrorBody {
  error: { code: string; message?: string };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createSheetSession(harness: Harness): Promise<{
  sessionId: string;
  accessToken: string;
  expiresAt: string;
}> {
  const response = await handleRequest(
    new Request(SHEET_SESSIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "turnstile-ok" }),
    }),
    harness.deps,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    sessionId: string;
    accessToken: string;
    expiresAt: string;
  };
}

function makeDraft(
  sessionId: string,
  draftId = "draft.abc123",
): CharacterSheetDraftV2 {
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
        max: 20,
        locked: true,
      },
      { key: "homeland", label: "Homeland", type: "textarea", locked: false },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow", "staff"],
        locked: true,
      },
      { key: "veteran", label: "Veteran", type: "checkbox", locked: false },
    ],
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "strength", parentKey: null },
      { kind: "field", key: "homeland", parentKey: null },
      { kind: "field", key: "weapon", parentKey: null },
      { kind: "field", key: "veteran", parentKey: null },
    ],
    values: {
      character_name: "Aria Stone",
      strength: 12,
      homeland: "Riverside",
      weapon: "sword",
      veteran: true,
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

function draftUrlPath(sessionId: string, draftId: string): string {
  return `${BASE_URL}/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`;
}

function postSession(harness: Harness, body: unknown): Promise<Response> {
  return handleRequest(
    new Request(SHEET_SESSIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    harness.deps,
  );
}

function getSession(
  harness: Harness,
  sessionId: string,
  token: string,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
    harness.deps,
  );
}

function createDraft(
  harness: Harness,
  sessionId: string,
  token: string,
  draft: CharacterSheetDraftV2,
): Promise<Response> {
  return handleRequest(
    new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(draft),
    }),
    harness.deps,
  );
}

function getDraft(
  harness: Harness,
  sessionId: string,
  token: string,
  draftId: string,
  version?: string,
): Promise<Response> {
  const query = version === undefined ? "" : `?version=${version}`;
  return handleRequest(
    new Request(`${draftUrlPath(sessionId, draftId)}${query}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
    harness.deps,
  );
}

function patchDraft(
  harness: Harness,
  sessionId: string,
  token: string,
  draftId: string,
  body: unknown,
): Promise<Response> {
  return handleRequest(
    new Request(draftUrlPath(sessionId, draftId), {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    harness.deps,
  );
}

function rerollDraft(
  harness: Harness,
  sessionId: string,
  token: string,
  draftId: string,
  body: unknown,
): Promise<Response> {
  return handleRequest(
    new Request(`${draftUrlPath(sessionId, draftId)}/reroll`, {
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

function confirmDraft(
  harness: Harness,
  sessionId: string,
  token: string,
  draftId: string,
  body: unknown = { expectedVersion: 1 },
): Promise<Response> {
  return handleRequest(
    new Request(`${draftUrlPath(sessionId, draftId)}/confirm`, {
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

describe("character-sheet session creation", () => {
  it("creates an anonymous 120-minute session and persists only the token hash", async () => {
    const harness = makeHarness();
    const response = await postSession(harness, {
      turnstileToken: "turnstile-ok",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      sessionId: string;
      accessToken: string;
      expiresAt: string;
    };
    expect(body.sessionId.length).toBeGreaterThan(0);
    expect(
      new Date(body.expiresAt).getTime() - harness.clock.now().getTime(),
    ).toBe(120 * 60 * 1000);
    const stored = await harness.sheetSessions.findById(body.sessionId);
    expect(stored?.tokenHash).not.toBe(body.accessToken);
  });

  it("rate limits by connecting IP before verifying or creating", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "denied" };
    const response = await postSession(harness, {
      turnstileToken: "turnstile-ok",
    });
    expect(response.status).toBe(429);
  });

  it("returns 429 when rate limited and creates no session", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "denied" };
    const response = await handleRequest(
      new Request(SHEET_SESSIONS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "1.2.3.4",
        },
        body: JSON.stringify({ turnstileToken: "turnstile-ok" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(429);
  });

  it("returns 503 when the rate limiter is unavailable", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "unavailable" };
    const response = await postSession(harness, {
      turnstileToken: "turnstile-ok",
    });
    expect(response.status).toBe(503);
  });

  it("returns 403 when turnstile fails", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "failed" };
    const response = await postSession(harness, {
      turnstileToken: "turnstile-bad",
    });
    expect(response.status).toBe(403);
  });

  it("returns 403 when human verification is unavailable", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "unavailable" };
    const response = await postSession(harness, {
      turnstileToken: "turnstile-ok",
    });
    expect(response.status).toBe(403);
  });

  it("rejects unknown properties and non-JSON bodies without a session", async () => {
    const harness = makeHarness();
    const extra = await postSession(harness, {
      turnstileToken: "turnstile-ok",
      extra: true,
    });
    expect(extra.status).toBe(400);
    const malformed = await handleRequest(
      new Request(SHEET_SESSIONS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      harness.deps,
    );
    expect(malformed.status).toBe(400);
  });
});

describe("character-sheet document extraction", () => {
  it("compiles an observed visual hierarchy into canonical V2 sections", async () => {
    const harness = makeHarness();
    harness.deps.sheetVisualExtraction = {
      extract: async () => ({
        schemaVersion: "1",
        document: { pageCount: 1 },
        nodes: [
          {
            kind: "section",
            label: "Attributes",
            children: [
              {
                kind: "section",
                label: "Physical",
                children: [
                  {
                    kind: "field",
                    label: "Strength",
                    control: {
                      kind: "rating",
                      constraints: { min: 0, max: 5 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    };
    const { sessionId, accessToken } = await createSheetSession(harness);
    const form = new FormData();
    form.append(
      "document",
      new Blob(["%PDF-1.4\n/Type /Page\nsheet-bytes"], {
        type: "application/pdf",
      }),
      "nyra.pdf",
    );
    form.append(
      "page",
      new Blob(
        [new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 1, 0, 1])],
        { type: "image/jpeg" },
      ),
      "page-1.jpg",
    );

    const response = await handleRequest(
      new Request(
        `${BASE_URL}/v1/character-sheets/sessions/${sessionId}/extraction`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          body: form,
        },
      ),
      harness.deps,
    );

    expect(response.status).toBe(200);
    const draft = await readJson<CharacterSheetDraftV2>(response);
    expect(draft.schemaVersion).toBe("2");
    expect(draft.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "strength", type: "number" }),
      ]),
    );
    expect(draft.sections).toEqual([
      expect.objectContaining({ key: "attributes" }),
      expect.objectContaining({ key: "physical" }),
    ]);
    // V2 structural authority lives in structure[], never in fieldKeys.
    for (const section of draft.sections) {
      expect(section).not.toHaveProperty("fieldKeys");
      expect(section).not.toHaveProperty("parentKey");
    }
    expect(draft.structure).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "section", key: "attributes" }),
        expect.objectContaining({
          kind: "field",
          key: "strength",
          parentKey: "physical",
        }),
      ]),
    );
  });

  it("rejects invalid document types and unavailable conversion", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const textForm = new FormData();
    textForm.append(
      "document",
      new Blob(["text"], { type: "text/plain" }),
      "sheet.txt",
    );
    const invalidType = await handleRequest(
      new Request(
        `${BASE_URL}/v1/character-sheets/sessions/${sessionId}/extraction`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          body: textForm,
        },
      ),
      harness.deps,
    );
    expect(invalidType.status).toBe(415);
    expect((await readJson<ErrorBody>(invalidType)).error.code).toBe(
      "SHEET_DOCUMENT_INVALID_TYPE",
    );

    const pdfForm = new FormData();
    pdfForm.append(
      "document",
      new Blob(["%PDF-1.4\n/Type /Page"], { type: "application/pdf" }),
      "sheet.pdf",
    );
    const unavailable = await handleRequest(
      new Request(
        `${BASE_URL}/v1/character-sheets/sessions/${sessionId}/extraction`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          body: pdfForm,
        },
      ),
      harness.deps,
    );
    expect(unavailable.status).toBe(503);
    expect((await readJson<ErrorBody>(unavailable)).error.code).toBe(
      "SHEET_DOCUMENT_EXTRACTION_UNAVAILABLE",
    );
  });
});

describe("character-sheet session reads", () => {
  it("returns the active session view for a valid token", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await getSession(harness, sessionId, accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessionId: string;
      status: string;
      expiresAt: string;
    };
    expect(body.status).toBe("ACTIVE");
    expect(body.sessionId).toBe(sessionId);
    expect(new Date(body.expiresAt)).toBeInstanceOf(Date);
  });

  it("rejects a wrong token", async () => {
    const harness = makeHarness();
    const { sessionId } = await createSheetSession(harness);
    const response = await getSession(harness, sessionId, "wrong-token");
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
    );
  });

  it("rejects a missing bearer header", async () => {
    const harness = makeHarness();
    const { sessionId } = await createSheetSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}`, { method: "GET" }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("returns 410 for an expired session", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    harness.clock.advance(120 * 60 * 1000 + 1);
    const response = await getSession(harness, sessionId, accessToken);
    expect(response.status).toBe(410);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_SESSION_EXPIRED",
    );
  });
});

describe("character-sheet draft creation", () => {
  it("creates a canonical V2 draft and persists the snapshot and head", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);

    const response = await createDraft(harness, sessionId, accessToken, draft);
    expect(response.status).toBe(201);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.schemaVersion).toBe("2");
    expect(body.version).toBe(1);
    expect(body.baseVersion).toBe(1);
    expect(body.draftId).toBe(draft.draftId);

    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(1);
    const stored = await harness.draftStore.getDraftVersion(
      { sessionId, draftId: draft.draftId },
      1,
    );
    expect(stored?.characterName).toBe("Aria Stone");
  });

  it("rejects a draft whose session id does not match the route", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await createDraft(
      harness,
      sessionId,
      accessToken,
      makeDraft("some-other-session"),
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
  });

  it("rejects a draft that does not start at version 1", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await createDraft(harness, sessionId, accessToken, {
      ...makeDraft(sessionId),
      version: 2,
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
  });

  it("rejects a draft whose baseVersion is not 1", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await createDraft(harness, sessionId, accessToken, {
      ...makeDraft(sessionId),
      baseVersion: 2,
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
    expect(harness.draftHeads.rows.size).toBe(0);
  });

  it("rejects an invalid draft body", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const broken = makeDraft(sessionId) as unknown as Record<string, unknown>;
    delete broken.fields;
    const response = await createDraft(
      harness,
      sessionId,
      accessToken,
      broken as unknown as CharacterSheetDraftV2,
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
    expect(harness.draftHeads.rows.size).toBe(0);
  });

  it("returns 409 for a duplicate create and never deletes the existing snapshot", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    const first = await createDraft(harness, sessionId, accessToken, draft);
    expect(first.status).toBe(201);

    const second = await createDraft(harness, sessionId, accessToken, draft);
    expect(second.status).toBe(409);
    expect((await readJson<ErrorBody>(second)).error.code).toBe(
      "SHEET_DRAFT_ALREADY_EXISTS",
    );

    expect(harness.bucket.objects.size).toBe(1);
    const stored = await harness.draftStore.getDraftVersion(
      { sessionId, draftId: draft.draftId },
      1,
    );
    expect(stored?.characterName).toBe("Aria Stone");
  });

  it("rejects draft creation for an unauthenticated session", async () => {
    const harness = makeHarness();
    const { sessionId } = await createSheetSession(harness);
    const response = await handleRequest(
      new Request(`${SHEET_SESSIONS_URL}/${sessionId}/drafts`, {
        method: "POST",
        headers: {
          authorization: "Bearer not-the-session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(makeDraft(sessionId)),
      }),
      harness.deps,
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
    );
  });

  it("returns 503 when draft storage is not configured", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const { sheetDraftStoreV2: _sheetDraftStoreV2, ...baseDeps } = harness.deps;
    const response = await createDraft(
      { ...harness, deps: { ...baseDeps } },
      sessionId,
      accessToken,
      makeDraft(sessionId),
    );
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );
    expect(harness.draftHeads.rows.size).toBe(0);
  });

  it("returns 503 when the snapshot write fails and leaves no head", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    harness.bucket.failNextPut = true;
    const response = await createDraft(
      harness,
      sessionId,
      accessToken,
      makeDraft(sessionId),
    );
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );
    expect(harness.draftHeads.rows.size).toBe(0);
  });
});

describe("character-sheet draft reads", () => {
  it("returns the latest committed version", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await patchDraft(harness, sessionId, accessToken, draft.draftId, {
      expectedVersion: 1,
      mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
    });

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.version).toBe(2);
    expect(body.values["homeland"]).toBe("Harbor Town");
  });

  it("serves an explicit early version unchanged", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await patchDraft(harness, sessionId, accessToken, draft.draftId, {
      expectedVersion: 1,
      mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
    });

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      "1",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.version).toBe(1);
    expect(body.values["homeland"]).toBe("Riverside");
  });

  it("serves a historical V1 snapshot as canonical V2", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draft.draftId, 1),
      JSON.stringify({
        ...draft,
        schemaVersion: "1",
        sections: undefined,
        structure: undefined,
      }),
    );

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      "1",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.schemaVersion).toBe("2");
    expect(body.version).toBe(1);
  });

  it("rejects a non-integer version parameter", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      "nope",
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
  });

  it("returns 404 for a missing draft", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      "missing.draft",
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_NOT_FOUND",
    );
  });

  it("rejects reads with a wrong token", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    const response = await getDraft(
      harness,
      sessionId,
      "wrong-token",
      draft.draftId,
    );
    expect(response.status).toBe(404);
  });
});

describe("character-sheet draft mutations", () => {
  it("applies a set_value mutation and commits a new immutable version", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.version).toBe(2);
    expect(body.values["homeland"]).toBe("Harbor Town");

    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(2);
    const v1 = await harness.draftStore.getDraftVersion(
      { sessionId, draftId: draft.draftId },
      1,
    );
    const v2 = await harness.draftStore.getDraftVersion(
      { sessionId, draftId: draft.draftId },
      2,
    );
    expect(v1?.values["homeland"]).toBe("Riverside");
    expect(v2?.values["homeland"]).toBe("Harbor Town");
    expect(v2?.schemaVersion).toBe("2");
  });

  it("requires an expectedVersion on every mutation", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      { op: "set_value", key: "homeland", value: "Harbor Town" },
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects a stale mutation with a version conflict", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await patchDraft(harness, sessionId, accessToken, draft.draftId, {
      expectedVersion: 1,
      mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
    });

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Stale" },
      },
    );
    expect(response.status).toBe(409);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_VERSION_CONFLICT",
    );
  });

  it("rejects editing a read-locked field without committing anything", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "strength", value: 18 },
      },
    );
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_FIELD_READ_LOCKED",
    );
    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(1);
    expect(harness.bucket.objects.size).toBe(1);
  });

  it("rejects a mutation outside the editable surface", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "nonexistent_field", value: "x" },
      },
    );
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_SURFACE_OUT_OF_BOUNDS",
    );
  });

  it("rejects an invalid mutation shape", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    // An unknown `op` never survives envelope parsing: V2 reports a malformed
    // envelope (400), while a well-formed envelope that fails family-level
    // semantics reports 422 (covered by the read-locked/surface tests).
    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "explode" },
      },
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("returns 404 when the draft does not exist", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      "missing",
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "x" },
      },
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_NOT_FOUND",
    );
  });

  it("returns 409 while another claim is in flight", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await harness.draftHeads.claim(
      { sessionId, draftId: draft.draftId },
      1,
      "claim-in-flight",
      harness.clock.now(),
    );

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
      },
    );
    expect(response.status).toBe(409);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INFLIGHT",
    );
  });

  it("releases the claim when the next snapshot write fails", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    harness.bucket.failNextPut = true;
    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
      },
    );
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );

    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(1);
    expect(head?.pendingVersion).toBeNull();

    harness.bucket.failNextPut = false;
    const retry = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Harbor Town" },
      },
    );
    expect(retry.status).toBe(200);
  });
});

describe("character-sheet draft reroll", () => {
  it("rerolls locked draw-grammar values with the client seed", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        seed: "sieve-relic-42",
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      draft: CharacterSheetDraftV2;
      rerolledKeys: string[];
    };
    expect(body.draft.version).toBe(2);
    expect(body.draft.schemaVersion).toBe("2");
    expect(body.rerolledKeys.sort()).toEqual(["strength", "weapon"]);
    expect(body.draft.values["strength"]).not.toBe(12);

    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(2);
    const v2 = await harness.draftStore.getDraftVersion(
      { sessionId, draftId: draft.draftId },
      2,
    );
    expect(v2?.values["strength"]).toBe(body.draft.values["strength"]);
    expect(v2?.values["weapon"]).toBe(body.draft.values["weapon"]);
  });

  it("replays the same values for the same seed", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    const first = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        seed: "fixed-seed",
      },
    );
    const firstBody = (await first.json()) as {
      draft: CharacterSheetDraftV2;
    };

    const redo = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 2,
        seed: "fixed-seed",
      },
    );
    const secondBody = (await redo.json()) as { draft: CharacterSheetDraftV2 };
    expect(secondBody.draft.values["strength"]).toBe(
      firstBody.draft.values["strength"],
    );
    expect(secondBody.draft.values["weapon"]).toBe(
      firstBody.draft.values["weapon"],
    );
  });

  it("requires an expectedVersion on every reroll", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        seed: "seed",
      },
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects a missing or empty seed", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        expectedVersion: 1,
        seed: "",
      },
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("returns 404 when the draft does not exist", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      "missing",
      {
        expectedVersion: 1,
        seed: "seed",
      },
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_NOT_FOUND",
    );
  });
});

describe("character-sheet draft confirm", () => {
  it("confirms the draft and returns the raw V2 snapshot", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await confirmDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      { expectedVersion: 1 },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraftV2;
    expect(body.version).toBe(2);
    expect(body.confirmed).toBe(true);
    expect(body.schemaVersion).toBe("2");
    expect(body).not.toHaveProperty("draft");

    const head = await harness.draftHeads.getHead({
      sessionId,
      draftId: draft.draftId,
    });
    expect(head?.currentVersion).toBe(2);
  });

  it("requires an expectedVersion on every confirm", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await handleRequest(
      new Request(`${draftUrlPath(sessionId, draft.draftId)}/confirm`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects the legacy empty-body confirm", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await handleRequest(
      new Request(`${draftUrlPath(sessionId, draft.draftId)}/confirm`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects confirming an already-confirmed draft", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await confirmDraft(harness, sessionId, accessToken, draft.draftId, {
      expectedVersion: 1,
    });

    const response = await confirmDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      { expectedVersion: 2 },
    );
    expect(response.status).toBe(409);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CONFIRMED",
    );
  });

  it("returns 404 when the draft does not exist", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const response = await confirmDraft(
      harness,
      sessionId,
      accessToken,
      "missing",
      { expectedVersion: 1 },
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_NOT_FOUND",
    );
  });
});

/**
 * 4E3A — error-mapping repairs.
 *
 * `SHEET_DRAFT_CORRUPT` and the domain `version_conflict` -> 409 mapping had no
 * producing arm in `draftErrorToResponse`, and every `getDraftVersion` call site
 * invoked the store directly, so a `DraftError` raised during a read escaped the
 * handler as an unhandled rejection rather than a contract response.
 */
describe("character-sheet draft error mapping (4E3A)", () => {
  async function seedDraft(): Promise<{
    harness: Harness;
    sessionId: string;
    accessToken: string;
    draftId: string;
  }> {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    const created = await createDraft(harness, sessionId, accessToken, draft);
    expect(created.status).toBe(201);
    return { harness, sessionId, accessToken, draftId: draft.draftId };
  }

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on a head-resolved read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draftId, 1),
      "{not json",
    );

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on a version-pinned read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draftId, 1),
      "{not json",
    );

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      "1",
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on the mutation read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draftId, 1),
      "{not json",
    );

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "North" },
      },
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on the reroll read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draftId, 1),
      "{not json",
    );

    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      {
        expectedVersion: 1,
        seed: "seed",
      },
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on the confirm read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.seed(
      getDraftSnapshotKey(sessionId, draftId, 1),
      "{not json",
    );

    const response = await confirmDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      { expectedVersion: 1 },
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps a storage_unavailable read failure to a 503, not a 422", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.bucket.failNextGet = true;

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );
  });

  it("maps a thrown domain version_conflict to 409 rather than 422", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    await patchDraft(harness, sessionId, accessToken, draftId, {
      expectedVersion: 1,
      mutation: { op: "set_value", key: "homeland", value: "First" },
    });

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "Stale" },
      },
    );

    // A stale expectedVersion is rejected by the barrier before any domain call.
    expect(response.status).toBe(409);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_VERSION_CONFLICT",
    );
  });

  it("still reports a missing snapshot as SHEET_DRAFT_NOT_FOUND", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      "99",
    );

    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_NOT_FOUND",
    );
  });

  it("leaves the existing SHEET_DRAFT_ALREADY_EXISTS create mapping intact", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);

    const response = await createDraft(harness, sessionId, accessToken, draft);

    expect(response.status).toBe(409);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_ALREADY_EXISTS",
    );
  });
});

/**
 * 4E5 — explicit V2-relevant DraftError mappings.
 *
 * These codes previously fell through to `SHEET_DRAFT_MUTATION_INVALID` (422).
 * Each is pinned through a live route so the mapping (not just the switch arm)
 * is covered for the V2 cutover.
 */
describe("character-sheet draft error mapping (4E5)", () => {
  async function seedDraft(): Promise<{
    harness: Harness;
    sessionId: string;
    accessToken: string;
    draftId: string;
  }> {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    const created = await createDraft(harness, sessionId, accessToken, draft);
    expect(created.status).toBe(201);
    return { harness, sessionId, accessToken, draftId: draft.draftId };
  }

  it("maps invalid_draft to SHEET_DRAFT_INVALID (400)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "invalid_draft";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
  });

  it("maps invalid_draft_identity to SHEET_DRAFT_INVALID (400)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "invalid_draft_identity";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_INVALID",
    );
  });

  it("maps invalid_mutation to SHEET_DRAFT_MUTATION_INVALID (422)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "invalid_mutation";

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      {
        expectedVersion: 1,
        mutation: { op: "set_value", key: "homeland", value: "North" },
      },
    );

    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_MUTATION_INVALID",
    );
  });

  it("maps cleanup_failed to SHEET_DRAFT_STORAGE_UNAVAILABLE (503)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "cleanup_failed";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );
  });

  it("maps projection_invalid to INTERNAL_ERROR (500)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "projection_invalid";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INTERNAL_ERROR",
    );
  });

  it("maps writeback_invalid to INTERNAL_ERROR (500)", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "writeback_invalid";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INTERNAL_ERROR",
    );
  });
});
