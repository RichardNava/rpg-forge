import { describe, expect, it } from "vitest";
import { handleRequest, type AppDeps } from "./handler.js";
import {
  FakeClock,
  FakeCrypto,
  FakeHumanVerification,
  FakeRateLimiter,
  FakeResourceCleaner,
  FakeRulebookRepository,
  FakeRulebookStorage,
  FakeRulebookWorkflow,
  FakeRulesAnalysisRunRepository,
  FakeSessionRepository,
  FakeSheetSessionRepository,
  FakeDraftHeadRepository,
  FakeCharacterSheetDraftStore,
} from "./test/fakes.js";

const BASE_URL = "https://rules-worker.test";

interface ErrorBody {
  error: { code: string; message?: string };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface Harness {
  deps: AppDeps;
  clock: FakeClock;
  crypto: FakeCrypto;
  repository: FakeSessionRepository;
  cleaner: FakeResourceCleaner;
  humanVerifier: FakeHumanVerification;
  rateLimiter: FakeRateLimiter;
  rulebookRepository: FakeRulebookRepository;
  rulebookStorage: FakeRulebookStorage;
  rulebookWorkflow: FakeRulebookWorkflow;
  rulesAnalysisRunRepository: FakeRulesAnalysisRunRepository;
  sheetSessionRepository: FakeSheetSessionRepository;
  sheetDraftHeadRepository: FakeDraftHeadRepository;
  sheetDraftStore: FakeCharacterSheetDraftStore;
}

function makeHarness(): Harness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const repository = new FakeSessionRepository();
  const cleaner = new FakeResourceCleaner();
  const humanVerifier = new FakeHumanVerification();
  const rateLimiter = new FakeRateLimiter();
  const rulebookRepository = new FakeRulebookRepository(clock);
  const rulebookStorage = new FakeRulebookStorage();
  const rulebookWorkflow = new FakeRulebookWorkflow();
  const rulesAnalysisRunRepository = new FakeRulesAnalysisRunRepository();
  const sheetSessionRepository = new FakeSheetSessionRepository();
  const sheetDraftHeadRepository = new FakeDraftHeadRepository();
  const sheetDraftStore = new FakeCharacterSheetDraftStore();
  return {
    deps: {
      crypto,
      clock,
      repository,
      cleaner,
      humanVerifier,
      rateLimiter,
      rulebookRepository,
      rulebookStorage,
      rulebookWorkflow,
      rulesAnalysisRunRepository,
      sheetSessionRepository,
      sheetDraftHeadRepository,
      sheetDraftStore,
    },
    clock,
    crypto,
    repository,
    cleaner,
    humanVerifier,
    rateLimiter,
    rulebookRepository,
    rulebookStorage,
    rulebookWorkflow,
    rulesAnalysisRunRepository,
    sheetSessionRepository,
    sheetDraftHeadRepository,
    sheetDraftStore,
  };
}

function postCreate(
  harness: Harness,
  body: unknown = { turnstileToken: "turnstile-ok" },
  headers: Record<string, string> = {},
): Promise<Response> {
  return handleRequest(
    new Request(`${BASE_URL}/v1/rules-analysis/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    harness.deps,
  );
}

function getSession(
  harness: Harness,
  analysisId: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  return handleRequest(
    new Request(`${BASE_URL}/v1/rules-analysis/sessions/${analysisId}`, {
      method: "GET",
      headers,
    }),
    harness.deps,
  );
}

function deleteSession(
  harness: Harness,
  analysisId: string,
  token: string,
): Promise<Response> {
  return handleRequest(
    new Request(`${BASE_URL}/v1/rules-analysis/sessions/${analysisId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
    harness.deps,
  );
}

async function createViaApi(harness: Harness): Promise<{
  analysisId: string;
  accessToken: string;
}> {
  const response = await postCreate(harness);
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    analysisId: string;
    accessToken: string;
  };
  return body;
}

describe("POST /v1/rules-analysis/sessions", () => {
  it("creates a session and returns the token exactly once", async () => {
    const harness = makeHarness();
    const response = await postCreate(harness);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      analysisId: string;
      accessToken: string;
      expiresAt: string;
    };
    expect(body.analysisId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.accessToken).toHaveLength(43);
    expect(new Date(body.expiresAt).getTime()).toBe(
      harness.clock.now().getTime() + 12 * 60 * 60 * 1000,
    );

    const created = await harness.repository.findById(body.analysisId);
    expect(created).not.toBeNull();
    expect(created!.tokenHash).not.toBe(body.accessToken);
    expect(created!.tokenHash).toBe(
      await harness.crypto.sha256Hex(
        new TextEncoder().encode(body.accessToken),
      ),
    );
    expect(harness.repository.createLog).toContain(body.analysisId);
  });

  it("rejects malformed JSON without creating a session", async () => {
    const harness = makeHarness();
    const response = await handleRequest(
      new Request(`${BASE_URL}/v1/rules-analysis/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      harness.deps,
    );
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
    expect(harness.repository.createLog).toHaveLength(0);
  });

  it("rejects unknown request properties without creating a session", async () => {
    const harness = makeHarness();
    const response = await postCreate(harness, {
      turnstileToken: "t",
      unexpected: "x",
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
    expect(harness.repository.createLog).toHaveLength(0);
  });

  it("rejects a missing turnstile token without creating a session", async () => {
    const harness = makeHarness();
    const response = await postCreate(harness, {});
    expect(response.status).toBe(400);
    expect(harness.repository.createLog).toHaveLength(0);
  });

  it("rate limits before D1 creation and creates no session", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "denied" };
    const response = await postCreate(harness);
    expect(response.status).toBe(429);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RATE_LIMITED",
    );
    expect(harness.repository.createLog).toHaveLength(0);
    expect(harness.rateLimiter.calls).toEqual(["create-session:unknown"]);
  });

  it("fails closed when rate limiting is unavailable and skips turnstile", async () => {
    const harness = makeHarness();
    harness.rateLimiter.result = { kind: "unavailable" };
    const response = await postCreate(harness);
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RATE_LIMIT_UNAVAILABLE",
    );
    expect(harness.repository.createLog).toHaveLength(0);
    expect(harness.humanVerifier.calls).toHaveLength(0);
  });

  it("denies creation when turnstile verification fails", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "failed" };
    const response = await postCreate(harness);
    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "HUMAN_VERIFICATION_FAILED",
    );
    expect(harness.repository.createLog).toHaveLength(0);
  });

  it("fails closed when verification is unavailable", async () => {
    const harness = makeHarness();
    harness.humanVerifier.result = { kind: "unavailable" };
    const response = await postCreate(harness);
    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "HUMAN_VERIFICATION_REQUIRED",
    );
    expect(harness.repository.createLog).toHaveLength(0);
  });

  it("runs rate limit before turnstile verification", async () => {
    const harness = makeHarness();
    await postCreate(harness);
    expect(harness.rateLimiter.calls.length).toBe(1);
    expect(harness.humanVerifier.calls.length).toBe(1);
    expect(harness.rateLimiter.calls[0]).toBe("create-session:unknown");
  });
});

describe("GET /v1/rules-analysis/sessions/:analysisId", () => {
  it("returns the public session view to an authorized caller", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    const response = await getSession(harness, analysisId, accessToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await readJson<Record<string, unknown>>(response);
    expect(body.analysisId).toBe(analysisId);
    expect(body.status).toBe("ACTIVE");
    expect(body).toHaveProperty("createdAt");
    expect(body).toHaveProperty("expiresAt");
    expect(body).not.toHaveProperty("tokenHash");
    expect(body).not.toHaveProperty("accessToken");
  });

  it("requires an Authorization header", async () => {
    const harness = makeHarness();
    const { analysisId } = await createViaApi(harness);
    const response = await getSession(harness, analysisId);
    expect(response.status).toBe(400);
  });

  it("rejects an analysisId alone (no token in query string)", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    const response = await handleRequest(
      new Request(
        `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}?accessToken=${accessToken}`,
        { method: "GET" },
      ),
      harness.deps,
    );
    expect(response.status).toBe(400);
  });

  it("does not reveal existence for a wrong token", async () => {
    const harness = makeHarness();
    const { analysisId } = await createViaApi(harness);
    const response = await getSession(harness, analysisId, "wrong-token-xxx");
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
    );
  });

  it("is indistinguishable for unknown analysisId vs wrong token", async () => {
    const harness = makeHarness();
    const unknown = await getSession(
      harness,
      "00000000-0000-4000-8000-000000000000",
      "some-token",
    );
    const { analysisId } = await createViaApi(harness);
    const wrong = await getSession(harness, analysisId, "some-token");
    expect(unknown.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await readJson<unknown>(unknown)).toEqual(
      await readJson<unknown>(wrong),
    );
  });

  it("returns 410 for an expired session with valid credentials", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    harness.clock.advance(12 * 60 * 60 * 1000 + 1);
    const response = await getSession(harness, analysisId, accessToken);
    expect(response.status).toBe(410);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "ANALYSIS_SESSION_EXPIRED",
    );
  });

  it("does not extend expiration when read", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    for (let i = 0; i < 5; i++) {
      await getSession(harness, analysisId, accessToken);
    }
    harness.clock.advance(12 * 60 * 60 * 1000 + 1);
    const late = await getSession(harness, analysisId, accessToken);
    expect(late.status).toBe(410);
  });

  it("rejects a malformed analysis id", async () => {
    const harness = makeHarness();
    const response = await getSession(harness, "not-a-uuid", "token");
    expect(response.status).toBe(400);
  });
});

describe("DELETE /v1/rules-analysis/sessions/:analysisId", () => {
  it("deletes an authorized session", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    const response = await deleteSession(harness, analysisId, accessToken);
    expect(response.status).toBe(200);
    expect((await readJson<{ deleted: boolean }>(response)).deleted).toBe(true);
    expect(harness.cleaner.cleaned).toContain(analysisId);
    expect(await harness.repository.findById(analysisId)).toBeNull();
  });

  it("does nothing for an unauthorized delete", async () => {
    const harness = makeHarness();
    const { analysisId } = await createViaApi(harness);
    const response = await deleteSession(harness, analysisId, "wrong-token");
    expect(response.status).toBe(404);
    expect(harness.repository.deleteLog).not.toContain(analysisId);
    const stored = await harness.repository.findById(analysisId);
    expect(stored!.status).toBe("ACTIVE");
  });

  it("returns a stable error when cleanup fails during delete", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    harness.cleaner.failOn.add(analysisId);
    const response = await deleteSession(harness, analysisId, accessToken);
    expect(response.status).toBe(500);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "ANALYSIS_SESSION_DELETE_FAILED",
    );
    const stored = await harness.repository.findById(analysisId);
    expect(stored!.status).toBe("DELETING");
    expect(harness.repository.deleteLog).not.toContain(analysisId);
  });

  it("is replay-safe: second delete returns no row", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } = await createViaApi(harness);
    await deleteSession(harness, analysisId, accessToken);
    const replay = await deleteSession(harness, analysisId, accessToken);
    expect(replay.status).toBe(404);
  });

  it("cannot delete another session cross-session", async () => {
    const harness = makeHarness();
    const a = await createViaApi(harness);
    const b = await createViaApi(harness);
    const response = await deleteSession(harness, b.analysisId, a.accessToken);
    expect(response.status).toBe(404);
    const bStored = await harness.repository.findById(b.analysisId);
    expect(bStored!.status).toBe("ACTIVE");
  });
});

describe("routing", () => {
  it("returns a stable 404 for unknown routes", async () => {
    const harness = makeHarness();
    const response = await handleRequest(
      new Request(`${BASE_URL}/v1/rules-analysis/upload`, { method: "POST" }),
      harness.deps,
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("does not implement upload/analysis/character-sheet routes without a session", async () => {
    const harness = makeHarness();
    for (const path of [
      "/v1/rules-analysis/upload",
      "/v1/rules-analysis/rulebooks",
      "/v1/rules-analysis/character-sheets",
    ]) {
      const response = await handleRequest(
        new Request(`${BASE_URL}${path}`, { method: "POST" }),
        harness.deps,
      );
      expect(response.status).toBe(404);
    }
  });
});

const CONSENT = "x-rules-upload-consent";
const RULEBOOK_URL = (analysisId: string) =>
  `${BASE_URL}/v1/rules-analysis/sessions/${analysisId}/rulebook`;

function pdfBytes(payload = "hello rulebook"): Uint8Array {
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

function putRulebook(
  harness: Harness,
  analysisId: string,
  token: string,
  options: {
    body?: Uint8Array;
    contentLength?: number;
    consent?: boolean;
    contentType?: string;
    ip?: string;
  } = {},
): Promise<Response> {
  const body = options.body ?? pdfBytes();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": options.contentType ?? "application/pdf",
    "content-length": String(options.contentLength ?? body.byteLength),
  };
  if (options.consent !== false) {
    headers[CONSENT] = "accepted";
  }
  if (options.ip !== undefined) {
    headers["cf-connecting-ip"] = options.ip;
  }
  return handleRequest(
    new Request(RULEBOOK_URL(analysisId), {
      method: "PUT",
      headers,
      body: body as unknown as BodyInit,
    }),
    harness.deps,
  );
}

async function createAuthenticatedSession(
  harness: Harness,
): Promise<{ analysisId: string; accessToken: string }> {
  return createViaApi(harness);
}

describe("PUT /v1/rules-analysis/sessions/:analysisId/rulebook", () => {
  it("requires explicit upload consent before any reservation", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await putRulebook(harness, analysisId, accessToken, {
      consent: false,
    });
    expect(response.status).toBe(403);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_UPLOAD_CONSENT_REQUIRED",
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
    expect(harness.rulebookStorage.raw.size).toBe(0);
  });

  it("rejects a non-PDF content type", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await putRulebook(harness, analysisId, accessToken, {
      contentType: "application/json",
    });
    expect(response.status).toBe(415);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_INVALID_CONTENT_TYPE",
    );
  });

  it("rejects a declared content length above the 50 MiB limit", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await putRulebook(harness, analysisId, accessToken, {
      contentLength: 50 * 1024 * 1024 + 1,
    });
    expect(response.status).toBe(413);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_TOO_LARGE",
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
    expect(harness.rulebookStorage.raw.size).toBe(0);
  });

  it("rejects a lying short content length when the actual body exceeds the limit", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const oversized = new Uint8Array(50 * 1024 * 1024 + 2);
    oversized[0] = 0x25;
    oversized[1] = 0x50;
    oversized[2] = 0x44;
    oversized[3] = 0x46;
    oversized[4] = 0x2d;
    const response = await putRulebook(harness, analysisId, accessToken, {
      body: oversized,
      contentLength: 10,
    });
    expect(response.status).toBe(413);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_TOO_LARGE",
    );
    const found = harness.rulebookRepository.findByAnalysisId(analysisId);
    expect(await found).toBeNull();
    expect(harness.rulebookStorage.raw.size).toBe(0);
  });

  it("rejects a body without a PDF signature and leaves no orphan reservation", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await putRulebook(harness, analysisId, accessToken, {
      body: new TextEncoder().encode("not a pdf at all"),
    });
    expect(response.status).toBe(400);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_INVALID_PDF",
    );
    const found = await harness.rulebookRepository.findByAnalysisId(analysisId);
    expect(found).toBeNull();
    expect(harness.rulebookStorage.raw.size).toBe(0);
  });

  it("rate limits uploads per analysis and client IP", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    harness.rateLimiter.result = { kind: "denied" };
    const response = await putRulebook(harness, analysisId, accessToken, {
      ip: "1.2.3.4",
    });
    expect(response.status).toBe(429);
    expect(harness.rateLimiter.calls).toContain(
      `rulebook-upload:${analysisId}:1.2.3.4`,
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
  });

  it("uploads a valid PDF, starts the workflow, and returns 202 with a public view", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await putRulebook(harness, analysisId, accessToken);
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("QUEUED");
    expect(body.sizeBytes).toBe(pdfBytes().byteLength);
    expect(body).not.toHaveProperty("ingestionId");
    expect(body).not.toHaveProperty("analysisId");
    expect(harness.rulebookWorkflow.started).toHaveLength(1);
  });

  it("rejects a second upload for the same session as already attached", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const first = await putRulebook(harness, analysisId, accessToken);
    expect(first.status).toBe(202);
    const second = await putRulebook(harness, analysisId, accessToken);
    expect(second.status).toBe(409);
    expect((await readJson<ErrorBody>(second)).error.code).toBe(
      "RULEBOOK_ALREADY_ATTACHED",
    );
    expect(harness.rulebookWorkflow.started).toHaveLength(1);
  });

  it("fails closed with 503 when storage is unavailable and reserves nothing durable", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    delete harness.deps.rulebookStorage;
    const response = await putRulebook(harness, analysisId, accessToken);
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_STORAGE_UNAVAILABLE",
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
  });

  it("fails closed with 503 when the workflow binding is missing", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    delete harness.deps.rulebookWorkflow;
    const response = await putRulebook(harness, analysisId, accessToken);
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_WORKFLOW_UNAVAILABLE",
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
  });

  it("cleans up the reservation when the workflow start fails", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    harness.rulebookWorkflow.failOnStart = true;
    const response = await putRulebook(harness, analysisId, accessToken);
    expect(response.status).toBe(500);
    const found = await harness.rulebookRepository.findByAnalysisId(analysisId);
    expect(found).toBeNull();
  });
});

describe("GET /v1/rules-analysis/sessions/:analysisId/rulebook", () => {
  it("returns the public rulebook view with no-store cache control", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    await putRulebook(harness, analysisId, accessToken);
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("ingestionId");
    expect(body).not.toHaveProperty("analysisId");
    expect(body.createdAt).toBeTypeOf("string");
    expect(body.updatedAt).toBeTypeOf("string");
  });

  it("does not expose ingestionId or internal identifiers in the public view", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    await putRulebook(harness, analysisId, accessToken);
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    const text = await response.text();
    expect(text).not.toContain("ingestionId");
    expect(text).not.toContain("temp/rules");
    expect(text).not.toContain("raw.pdf");
    expect(text).not.toContain('"chunks"');
    expect(text).not.toContain('"text"');
  });

  it("returns 404 when no rulebook is attached", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(404);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_NOT_FOUND",
    );
  });
});

describe("DELETE /v1/rules-analysis/sessions/:analysisId/rulebook", () => {
  it("is replay-safe: repeated deletes after removal return 204 with no new destructive work", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    await putRulebook(harness, analysisId, accessToken);

    const first = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(first.status).toBe(204);
    expect(harness.rulebookWorkflow.terminated).toHaveLength(1);
    expect(harness.rulebookRepository.rows.size).toBe(0);

    const before = harness.rulebookWorkflow.terminated.length;
    const replay = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(replay.status).toBe(204);
    expect(harness.rulebookWorkflow.terminated).toHaveLength(before);
  });

  it("returns 204 (idempotent) even when no rulebook exists", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(204);
  });

  it("fails closed with 503 when storage is unavailable", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);
    await putRulebook(harness, analysisId, accessToken);
    delete harness.deps.rulebookStorage;
    const response = await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(response.status).toBe(503);
    expect((await readJson<ErrorBody>(response)).error.code).toBe(
      "RULEBOOK_STORAGE_UNAVAILABLE",
    );
  });
});

describe("rulebook generation isolation", () => {
  it("upload A, remove A, upload B: removal of A never touches B's artifacts", async () => {
    const harness = makeHarness();
    const { analysisId, accessToken } =
      await createAuthenticatedSession(harness);

    await putRulebook(harness, analysisId, accessToken);
    const first = await harness.rulebookRepository.findByAnalysisId(analysisId);
    expect(first?.status).toBe("QUEUED");

    await handleRequest(
      new Request(RULEBOOK_URL(analysisId), {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      harness.deps,
    );
    expect(harness.rulebookRepository.rows.size).toBe(0);
    expect(harness.rulebookStorage.raw.size).toBe(0);

    await putRulebook(harness, analysisId, accessToken);
    const second =
      await harness.rulebookRepository.findByAnalysisId(analysisId);
    expect(second).not.toBeNull();
    expect(second!.ingestionId).not.toBe(first!.ingestionId);
    expect(harness.rulebookStorage.raw.size).toBe(1);
  });
});
