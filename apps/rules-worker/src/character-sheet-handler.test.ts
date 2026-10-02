import { describe, expect, it } from "vitest";
import type { CharacterSheetDraft } from "@repo/character-sheet-draft";
import { handleRequest, type AppDeps } from "./handler.js";
import {
  FakeCharacterSheetDraftStore,
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

interface Harness {
  deps: AppDeps;
  clock: FakeClock;
  crypto: FakeCrypto;
  rateLimiter: FakeRateLimiter;
  humanVerifier: FakeHumanVerification;
  sheetSessions: FakeSheetSessionRepository;
  draftHeads: FakeDraftHeadRepository;
  draftStore: FakeCharacterSheetDraftStore;
}

function makeHarness(): Harness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const rateLimiter = new FakeRateLimiter();
  const humanVerifier = new FakeHumanVerification();
  const sheetSessions = new FakeSheetSessionRepository();
  const draftHeads = new FakeDraftHeadRepository();
  const draftStore = new FakeCharacterSheetDraftStore();
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
    sheetDraftStore: draftStore,
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
): CharacterSheetDraft {
  return {
    schemaVersion: "1",
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
  draft: CharacterSheetDraft,
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
  mutation: unknown,
): Promise<Response> {
  return handleRequest(
    new Request(draftUrlPath(sessionId, draftId), {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(mutation),
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
): Promise<Response> {
  return handleRequest(
    new Request(`${draftUrlPath(sessionId, draftId)}/confirm`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
    harness.deps,
  );
}

describe("character-sheet session creation", () => {
  it("creates an anonymous 120-minute session and persists only the token hash", async () => {
    const harness = makeHarness();
    const response = await postSession(harness, { turnstileToken: "ok" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      sessionId: string;
      accessToken: string;
      expiresAt: string;
    };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.accessToken.length).toBeGreaterThan(20);
    expect(new Date(body.expiresAt).getTime()).toBe(
      harness.clock.now().getTime() + 120 * 60 * 1000,
    );

    const stored = await harness.sheetSessions.findById(body.sessionId);
    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).not.toBe(body.accessToken);
    expect(stored!.tokenHash).toBe(
      await harness.crypto.sha256Hex(
        new TextEncoder().encode(body.accessToken),
      ),
    );
    expect(harness.humanVerifier.calls).toContain("verify");
  });

  it("rate limits by connecting IP before verifying or creating", async () => {
    const harness = makeHarness();
    harness.rateLimiter.calls.length = 0;
    const response = await handleRequest(
      new Request(SHEET_SESSIONS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
        },
        body: JSON.stringify({ turnstileToken: "ok" }),
      }),
      harness.deps,
    );
    expect(response.status).toBe(201);
    expect(harness.rateLimiter.calls).toContain(
      "sheet-session-create:203.0.113.7",
    );
  });

  it("returns 429 when rate limited and creates no session", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "denied" };
    const response = await postSession(harness, { turnstileToken: "ok" });
    expect(response.status).toBe(429);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RATE_LIMITED",
    );
    expect(harness.sheetSessions.createLog).toHaveLength(0);
    expect(harness.humanVerifier.calls).toHaveLength(0);
  });

  it("returns 503 when the rate limiter is unavailable", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "unavailable" };
    const response = await postSession(harness, { turnstileToken: "ok" });
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RATE_LIMIT_UNAVAILABLE",
    );
  });

  it("returns 403 when turnstile fails", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "failed" };
    const response = await postSession(harness, { turnstileToken: "bad" });
    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "HUMAN_VERIFICATION_FAILED",
    );
    expect(harness.sheetSessions.createLog).toHaveLength(0);
  });

  it("returns 403 when human verification is unavailable", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "unavailable" };
    const response = await postSession(harness, { turnstileToken: "ok" });
    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "HUMAN_VERIFICATION_REQUIRED",
    );
  });

  it("rejects unknown properties and non-JSON bodies without a session", async () => {
    const harness = makeHarness();
    const unknown = await postSession(harness, {
      turnstileToken: "ok",
      extra: true,
    });
    expect(unknown.status).toBe(400);

    const notJson = await handleRequest(
      new Request(SHEET_SESSIONS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      harness.deps,
    );
    expect(notJson.status).toBe(400);
    expect((await readJson<ErrorBody>(notJson)).error.code).toBe(
      "INVALID_REQUEST",
    );
    expect(harness.sheetSessions.createLog).toHaveLength(0);
  });
});

describe("character-sheet document extraction", () => {
  it("compiles an observed visual hierarchy into draft sections", async () => {
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
    const draft = await readJson<CharacterSheetDraft>(response);
    expect(draft.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "strength", type: "number" }),
      ]),
    );
    expect(draft.sections).toEqual([
      expect.objectContaining({ key: "attributes", fieldKeys: [] }),
      expect.objectContaining({
        key: "physical",
        parentKey: "attributes",
        fieldKeys: ["strength"],
      }),
    ]);
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
  it("creates a v1 draft and persists the snapshot and head", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);

    const response = await createDraft(harness, sessionId, accessToken, draft);
    expect(response.status).toBe(201);
    const body = (await response.json()) as CharacterSheetDraft;
    expect(body.version).toBe(1);
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

  it("rejects an invalid draft body", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const broken = makeDraft(sessionId) as unknown as Record<string, unknown>;
    delete broken.fields;
    const response = await createDraft(
      harness,
      sessionId,
      accessToken,
      broken as unknown as CharacterSheetDraft,
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

    expect(harness.draftStore.snapshots.size).toBe(1);
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
    const { sheetDraftStore: _sheetDraftStore, ...baseDeps } = harness.deps;
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
    harness.draftStore.failOnPutDraft = true;
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
      op: "set_value",
      key: "homeland",
      value: "Harbor Town",
    });

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraft;
    expect(body.version).toBe(2);
    expect(body.values["homeland"]).toBe("Harbor Town");
  });

  it("serves an explicit early version unchanged", async () => {
    const harness = makeHarness();
    const { sessionId, accessToken } = await createSheetSession(harness);
    const draft = makeDraft(sessionId);
    await createDraft(harness, sessionId, accessToken, draft);
    await patchDraft(harness, sessionId, accessToken, draft.draftId, {
      op: "set_value",
      key: "homeland",
      value: "Harbor Town",
    });

    const response = await getDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      "1",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraft;
    expect(body.version).toBe(1);
    expect(body.values["homeland"]).toBe("Riverside");
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
        op: "set_value",
        key: "homeland",
        value: "Harbor Town",
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CharacterSheetDraft;
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
        op: "set_value",
        key: "strength",
        value: 18,
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
    expect(harness.draftStore.snapshots.size).toBe(1);
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
        op: "set_value",
        key: "nonexistent_field",
        value: "x",
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

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        op: "explode",
      },
    );
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_MUTATION_INVALID",
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
        op: "set_value",
        key: "homeland",
        value: "x",
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
        op: "set_value",
        key: "homeland",
        value: "Harbor Town",
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

    harness.draftStore.failOnPutDraft = true;
    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        op: "set_value",
        key: "homeland",
        value: "Harbor Town",
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

    harness.draftStore.failOnPutDraft = false;
    const retry = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        op: "set_value",
        key: "homeland",
        value: "Harbor Town",
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
        seed: "sieve-relic-42",
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      draft: CharacterSheetDraft;
      rerolledKeys: string[];
    };
    expect(body.draft.version).toBe(2);
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
        seed: "fixed-seed",
      },
    );
    const firstBody = (await first.json()) as { draft: CharacterSheetDraft };

    const redo = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draft.draftId,
      {
        seed: "fixed-seed",
      },
    );
    const secondBody = (await redo.json()) as { draft: CharacterSheetDraft };
    expect(secondBody.draft.values["strength"]).toBe(
      firstBody.draft.values["strength"],
    );
    expect(secondBody.draft.values["weapon"]).toBe(
      firstBody.draft.values["weapon"],
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
        seed: "seed",
      },
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
    harness.draftStore.failOnGetDraftVersion = "corrupt_draft";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on a version-pinned read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "corrupt_draft";

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
    harness.draftStore.failOnGetDraftVersion = "corrupt_draft";

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      { op: "set_value", key: "homeland", value: "North" },
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on the reroll read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "corrupt_draft";

    const response = await rerollDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      { seed: "seed" },
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps corrupt_draft to SHEET_DRAFT_CORRUPT on the confirm read", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "corrupt_draft";

    const response = await confirmDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
    );

    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_CORRUPT",
    );
  });

  it("maps a storage_unavailable read failure to a 503, not a 422", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "storage_unavailable";

    const response = await getDraft(harness, sessionId, accessToken, draftId);

    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "SHEET_DRAFT_STORAGE_UNAVAILABLE",
    );
  });

  it("maps a thrown domain version_conflict to 409 rather than 422", async () => {
    const { harness, sessionId, accessToken, draftId } = await seedDraft();
    harness.draftStore.failOnGetDraftVersion = "version_conflict";

    const response = await patchDraft(
      harness,
      sessionId,
      accessToken,
      draftId,
      { op: "set_value", key: "homeland", value: "North" },
    );

    // A domain version_conflict is V2-shaped; V1 never raises it from a read.
    // The assertion pins the MAPPING (409 + the conflict code), which is what
    // 4E3B depends on once V2 primitives are wired into this route.
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
