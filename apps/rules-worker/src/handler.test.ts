import { describe, expect, it } from "vitest";
import { handleRequest, type AppDeps } from "./handler.js";
import {
  FakeClock,
  FakeCrypto,
  FakeHumanVerification,
  FakeRateLimiter,
  FakeResourceCleaner,
  FakeSessionRepository,
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
}

function makeHarness(): Harness {
  const clock = new FakeClock("2026-09-07T00:00:00.000Z");
  const crypto = new FakeCrypto();
  const repository = new FakeSessionRepository();
  const cleaner = new FakeResourceCleaner();
  const humanVerifier = new FakeHumanVerification();
  const rateLimiter = new FakeRateLimiter();
  return {
    deps: {
      crypto,
      clock,
      repository,
      cleaner,
      humanVerifier,
      rateLimiter,
    },
    clock,
    crypto,
    repository,
    cleaner,
    humanVerifier,
    rateLimiter,
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

  it("does not implement upload/analysis/character-sheet routes", async () => {
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
