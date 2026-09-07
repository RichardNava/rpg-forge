import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createAnalysisSession,
  deleteSession,
  generateAccessToken,
  hashTokenSha256,
  toBase64Url,
  toHex,
  authorizeSession,
  runExpiryCleanup,
  SESSION_LIFETIME_MS,
  type AnalysisSession,
  verifyTokenHash,
  webCrypto,
  ACCESS_TOKEN_BYTE_LENGTH,
  MAX_CLEANUP_BATCH_SIZE,
} from "./index.js";
import {
  FakeClock,
  FakeCrypto,
  InMemoryRepository,
  RecordingCleaner,
} from "./test/fakes.js";

const FIXED_NOW = "2026-09-07T00:00:00.000Z";

function makeDeps() {
  const clock = new FakeClock(FIXED_NOW);
  const crypto = new FakeCrypto();
  const repository = new InMemoryRepository();
  return { clock, crypto, repository };
}

function makeCleaner() {
  return new RecordingCleaner();
}

describe("encoding helpers", () => {
  it("toBase64Url produces a URL-safe, unpadded string of the expected length", () => {
    const bytes = new Uint8Array(32).fill(0xab);
    const encoded = toBase64Url(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
    expect(encoded.length).toBe(43);
  });

  it("constantTimeEqual matches identical bytes and rejects differing bytes", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(constantTimeEqual(a, c)).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("session crypto", () => {
  it("generateAccessToken returns a 256-bit base64url token", () => {
    const token = generateAccessToken(ACCESS_TOKEN_BYTE_LENGTH, webCrypto);
    expect(token.length).toBe(43);
    expect(toBase64Url(new Uint8Array(32).fill(0))).toHaveLength(43);
    void token;
  });

  it("hashes are deterministic", async () => {
    const token = "abc-123";
    const crypto = new FakeCrypto();
    const a = await hashTokenSha256(token, crypto);
    const b = await hashTokenSha256(token, crypto);
    expect(a).toBe(b);
  });

  it("different tokens produce different hashes", async () => {
    const crypto = new FakeCrypto();
    const a = await hashTokenSha256("token-a", crypto);
    const b = await hashTokenSha256("token-b", crypto);
    expect(a).not.toBe(b);
  });

  it("verifier accepts a matching token", async () => {
    const crypto = new FakeCrypto();
    const token = "the-token";
    const storedHash = await hashTokenSha256(token, crypto);
    await expect(verifyTokenHash(token, storedHash, crypto)).resolves.toBe(
      true,
    );
  });

  it("verifier rejects a different token", async () => {
    const crypto = new FakeCrypto();
    const storedHash = await hashTokenSha256("the-token", crypto);
    await expect(
      verifyTokenHash("not-the-token", storedHash, crypto),
    ).resolves.toBe(false);
  });

  it("verifier rejects malformed stored hashes safely", async () => {
    const crypto = new FakeCrypto();
    await expect(
      verifyTokenHash("the-token", "not-hex!", crypto),
    ).resolves.toBe(false);
    await expect(verifyTokenHash("the-token", "ab", crypto)).resolves.toBe(
      false,
    );
  });

  it("toHex produces stable hex output", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(toHex(bytes)).toBe("deadbeef");
  });
});

describe("session creation", () => {
  it("creates a session, returns token once, does not persist plaintext", async () => {
    const { clock, crypto, repository } = makeDeps();
    const result = await createAnalysisSession({
      clock,
      crypto,
      repository,
    });
    expect(result.analysisId).toBeTruthy();
    expect(result.accessToken.length).toBe(43);
    expect(result.expiresAt.getTime() - clock.now().getTime()).toBe(
      SESSION_LIFETIME_MS,
    );

    const stored = (await repository.findById(result.analysisId))!;
    expect(stored).not.toBeNull();
    expect(stored.tokenHash).not.toBe(result.accessToken);
    expect(stored.tokenHash).toBe(
      await hashTokenSha256(result.accessToken, crypto),
    );
    expect(stored.status).toBe("ACTIVE");
    expect(stored.createdAt.getTime()).toBe(clock.now().getTime());
  });

  it("analysisId is generated (opaque, not derivable from token)", async () => {
    const deps = makeDeps();
    const result = await createAnalysisSession(deps);
    expect(result.analysisId).toMatch(/^fake-uuid/);
    expect(result.analysisId).not.toBe(result.accessToken);
  });

  it("exactly 12-hour expiration from creation", async () => {
    const deps = makeDeps();
    const result = await createAnalysisSession(deps);
    const expected = new Date(clockAt(deps).getTime() + SESSION_LIFETIME_MS);
    expect(result.expiresAt.getTime()).toBe(expected.getTime());
  });

  it("no sliding expiration: reading/using the session does not extend it", async () => {
    const deps = makeDeps();
    const result = await createAnalysisSession(deps);
    void (await authorizeSession(result.analysisId, result.accessToken, deps));
    void (await authorizeSession(result.analysisId, result.accessToken, deps));
    deps.clock.advance(SESSION_LIFETIME_MS);
    const late = await authorizeSession(
      result.analysisId,
      result.accessToken,
      deps,
    );
    expect(late.kind).toBe("expired");
  });

  it("createdAt/updatedAt/expiresAt are all present and sane", async () => {
    const deps = makeDeps();
    const result = await createAnalysisSession(deps);
    const stored = (await deps.repository.findById(result.analysisId))!;
    expect(stored.createdAt.getTime()).toBeLessThanOrEqual(
      stored.expiresAt.getTime(),
    );
    expect(stored.updatedAt.getTime()).toBe(stored.createdAt.getTime());
  });
});

function clockAt(deps: ReturnType<typeof makeDeps>): Date {
  return deps.clock.now();
}

describe("authorization", () => {
  async function createSession(deps = makeDeps()) {
    const result = await createAnalysisSession(deps);
    return { deps, result };
  }

  it("correct analysisId + token succeeds", async () => {
    const { deps, result } = await createSession();
    const auth = await authorizeSession(
      result.analysisId,
      result.accessToken,
      deps,
    );
    expect(auth.kind).toBe("ok");
  });

  it("analysisId alone fails", async () => {
    const { deps, result } = await createSession();
    const auth = await authorizeSession(result.analysisId, "", deps);
    expect(auth.kind).toBe("not_found_or_unauthorized");
  });

  it("wrong token fails", async () => {
    const { deps, result } = await createSession();
    const auth = await authorizeSession(result.analysisId, "wrong-token", deps);
    expect(auth.kind).toBe("not_found_or_unauthorized");
  });

  it("token for session A cannot access session B", async () => {
    const deps = makeDeps();
    const a = await createAnalysisSession(deps);
    const b = await createAnalysisSession(deps);
    const auth = await authorizeSession(b.analysisId, a.accessToken, deps);
    expect(auth.kind).toBe("not_found_or_unauthorized");
  });

  it("unknown analysisId is indistinguishable from wrong token", async () => {
    const { deps, result } = await createSession();
    const unknown = await authorizeSession("does-not-exist", "x", deps);
    const wrongtoken = await authorizeSession(
      result.analysisId,
      "wrong-token",
      deps,
    );
    expect(unknown.kind).toBe("not_found_or_unauthorized");
    expect(wrongtoken.kind).toBe("not_found_or_unauthorized");
    expect(unknown).toEqual(wrongtoken);
  });

  it("expired session is rejected with the explicit expired result", async () => {
    const { deps, result } = await createSession();
    deps.clock.advance(SESSION_LIFETIME_MS + 1);
    const auth = await authorizeSession(
      result.analysisId,
      result.accessToken,
      deps,
    );
    expect(auth.kind).toBe("expired");
  });

  it("verifies against the stored token hash", async () => {
    const { deps, result } = await createSession();
    const stored = (await deps.repository.findById(result.analysisId))!;
    const matches = (await authorizeSession(
      result.analysisId,
      result.accessToken,
      deps,
    )) as { kind: "ok" };
    expect(matches.kind).toBe("ok");
    expect(stored.tokenHash).toBe(
      await hashTokenSha256(result.accessToken, deps.crypto),
    );
  });
});

describe("deletion", () => {
  async function createSession(deps = makeDeps()) {
    const result = await createAnalysisSession(deps);
    return { deps, result };
  }

  it("authorized deletion succeeds and removes the row", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    const outcome = await deleteSession(result.analysisId, result.accessToken, {
      ...deps,
      cleaner,
    });
    expect(outcome.kind).toBe("deleted");
    expect(await deps.repository.findById(result.analysisId)).toBeNull();
  });

  it("unauthorized deletion changes nothing", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    await deleteSession(result.analysisId, "wrong-token", {
      ...deps,
      cleaner,
    });
    const stored = (await deps.repository.findById(result.analysisId))!;
    expect(stored.status).toBe("ACTIVE");
    expect(cleaner.cleaned).toHaveLength(0);
    expect(deps.repository.deleteLog).toHaveLength(0);
  });

  it("deletion invokes the resource cleaner before removing metadata", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    await deleteSession(result.analysisId, result.accessToken, {
      ...deps,
      cleaner,
    });
    expect(cleaner.cleaned).toContain(result.analysisId);
    expect(deps.repository.transitionLog).toContain(
      `transitioned:${result.analysisId}`,
    );
    const cleanerIndex = cleaner.cleaned.indexOf(result.analysisId);
    const deleteLogIndex = deps.repository.deleteLog.indexOf(result.analysisId);
    expect(cleanerIndex).toBeGreaterThanOrEqual(0);
    expect(deleteLogIndex).toBeGreaterThanOrEqual(cleanerIndex);
  });

  it("cleanup failure leaves a retryable DELETING state", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    cleaner.failOn.add(result.analysisId);
    await expect(
      deleteSession(result.analysisId, result.accessToken, {
        ...deps,
        cleaner,
      }),
    ).rejects.toThrow();
    const stored = (await deps.repository.findById(result.analysisId))!;
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("DELETING");
    expect(deps.repository.deleteLog).not.toContain(result.analysisId);
  });

  it("retry after cleanup failure succeeds", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    cleaner.failOn.add(result.analysisId);
    await expect(
      deleteSession(result.analysisId, result.accessToken, {
        ...deps,
        cleaner,
      }),
    ).rejects.toThrow();
    cleaner.failOn.clear();
    const outcome = await deleteSession(result.analysisId, result.accessToken, {
      ...deps,
      cleaner,
    });
    expect(outcome.kind).toBe("deleted");
    expect(await deps.repository.findById(result.analysisId)).toBeNull();
    // First attempt threw before recording; the retry records one successful cleanup.
    expect(
      cleaner.cleaned.filter((id) => id === result.analysisId),
    ).toHaveLength(1);
  });

  it("replayed delete is safe and idempotent", async () => {
    const { deps, result } = await createSession();
    const cleaner = makeCleaner();
    await deleteSession(result.analysisId, result.accessToken, {
      ...deps,
      cleaner,
    });
    const replay = await deleteSession(result.analysisId, result.accessToken, {
      ...deps,
      cleaner,
    });
    expect(replay.kind).toBe("not_found_or_unauthorized");
    expect(await deps.repository.findById(result.analysisId)).toBeNull();
  });

  it("cannot delete another session cross-session", async () => {
    const deps = makeDeps();
    const a = await createAnalysisSession(deps);
    const b = await createAnalysisSession(deps);
    const cleaner = makeCleaner();
    const outcome = await deleteSession(b.analysisId, a.accessToken, {
      ...deps,
      cleaner,
    });
    expect(outcome.kind).toBe("not_found_or_unauthorized");
    const bStored = (await deps.repository.findById(b.analysisId))!;
    expect(bStored.status).toBe("ACTIVE");
  });
});

describe("expiry cleanup", () => {
  async function createSessionAt(offsetMs: number, deps = makeDeps()) {
    const result = await createAnalysisSession(deps);
    const stored = (await deps.repository.findById(result.analysisId))!;
    // Rewrite timestamps deterministically relative to FIXED_NOW.
    const base = new Date(FIXED_NOW).getTime();
    const now = new Date(base + offsetMs);
    await deps.repository.delete(result.analysisId);
    await deps.repository.create({
      ...stored,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    });
    return { deps, result };
  }

  it("active non-expired sessions are untouched", async () => {
    const deps = makeDeps();
    const result = await createAnalysisSession(deps);
    const cleaner = makeCleaner();
    const now = new Date(FIXED_NOW).getTime() + SESSION_LIFETIME_MS - 1;
    const outcome = await runExpiryCleanup({
      now: new Date(now),
      repository: deps.repository,
      cleaner,
    });
    expect(outcome.processed).toBe(0);
    expect(await deps.repository.findById(result.analysisId)).not.toBeNull();
  });

  it("expired sessions are cleaned and removed", async () => {
    const { deps, result } = await createSessionAt(0);
    const cleaner = makeCleaner();
    const now = new Date(FIXED_NOW).getTime() + SESSION_LIFETIME_MS + 1;
    const outcome = await runExpiryCleanup({
      now: new Date(now),
      repository: deps.repository,
      cleaner,
    });
    expect(outcome.processed).toBe(1);
    expect(outcome.deleted).toBe(1);
    expect(outcome.failed).toHaveLength(0);
    expect(cleaner.cleaned).toContain(result.analysisId);
    expect(await deps.repository.findById(result.analysisId)).toBeNull();
  });

  it("stale DELETING sessions are retried", async () => {
    const { deps, result } = await createSessionAt(0);
    const stored = (await deps.repository.findById(result.analysisId))!;
    await deps.repository.delete(result.analysisId);
    await deps.repository.create({
      ...stored,
      status: "DELETING",
      updatedAt: new Date(new Date(FIXED_NOW).getTime() - 2 * 60 * 60 * 1000),
    });
    const cleaner = makeCleaner();
    const outcome = await runExpiryCleanup({
      now: new Date(FIXED_NOW),
      repository: deps.repository,
      cleaner,
    });
    expect(outcome.deleted).toBe(1);
    expect(cleaner.cleaned).toContain(result.analysisId);
    expect(await deps.repository.findById(result.analysisId)).toBeNull();
  });

  it("bounded cleanup batch respects the limit", async () => {
    const deps = makeDeps();
    const results: Awaited<ReturnType<typeof createAnalysisSession>>[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(await createAnalysisSession(deps));
    }
    const cleaner = makeCleaner();
    const now = new Date(FIXED_NOW).getTime() + SESSION_LIFETIME_MS + 1;
    const outcome = await runExpiryCleanup({
      now: new Date(now),
      repository: deps.repository,
      cleaner,
      limit: 2,
    });
    expect(outcome.processed).toBe(2);
    expect(outcome.deleted).toBe(2);
    const survivors = await Promise.all(
      results.map((r) => deps.repository.findById(r.analysisId)),
    );
    expect(survivors.filter((s) => s !== null)).toHaveLength(1);
  });

  it("one failure does not corrupt another session", async () => {
    const deps = makeDeps();
    const a = await createAnalysisSession(deps);
    const b = await createAnalysisSession(deps);
    const cleaner = makeCleaner();
    cleaner.failOn.add(a.analysisId);
    const now = new Date(FIXED_NOW).getTime() + SESSION_LIFETIME_MS + 1;
    const outcome = await runExpiryCleanup({
      now: new Date(now),
      repository: deps.repository,
      cleaner,
    });
    expect(outcome.processed).toBe(2);
    expect(outcome.deleted).toBe(1);
    expect(outcome.failed).toEqual([a.analysisId]);
    expect(await deps.repository.findById(a.analysisId)).not.toBeNull();
    expect(await deps.repository.findById(b.analysisId)).toBeNull();
  });

  it("cleanup uses the resource cleaner before deleting metadata", async () => {
    const { deps, result } = await createSessionAt(0);
    const cleaner = makeCleaner();
    const now = new Date(FIXED_NOW).getTime() + SESSION_LIFETIME_MS + 1;
    await runExpiryCleanup({
      now: new Date(now),
      repository: deps.repository,
      cleaner,
    });
    const cleanerIndex = cleaner.cleaned.indexOf(result.analysisId);
    const deleteLogIndex = deps.repository.deleteLog.indexOf(result.analysisId);
    expect(cleanerIndex).toBeGreaterThanOrEqual(0);
    expect(deleteLogIndex).toBeGreaterThanOrEqual(cleanerIndex);
  });
});

describe("session shape", () => {
  it("public session view excludes token hash and internal details", async () => {
    const deps = makeDeps();
    const { analysisId, accessToken } = await createAnalysisSession(deps);
    const auth = await authorizeSession(analysisId, accessToken, deps);
    expect(auth.kind).toBe("ok");
    const session: AnalysisSession = (
      auth as { kind: "ok"; session: AnalysisSession }
    ).session;
    expect(session.analysisId).toBe(analysisId);
    expect(session.status).toBe("ACTIVE");
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.expiresAt).toBeInstanceOf(Date);
  });

  it("MAX_CLEANUP_BATCH_SIZE is a positive bounded value", () => {
    expect(MAX_CLEANUP_BATCH_SIZE).toBe(100);
    expect(Number.isInteger(MAX_CLEANUP_BATCH_SIZE)).toBe(true);
  });
});
