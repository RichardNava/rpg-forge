import { describe, expect, it } from "vitest";
import { hashTokenSha256 } from "@repo/rules-analysis-session";
import {
  SHEET_CLEANUP_RETRY_GRACE_MS,
  SHEET_RUN_FAILURE_CODES,
  SHEET_RUN_MODES,
  SHEET_RUN_STATUSES,
  SHEET_SESSION_LIFETIME_MS,
  SHEET_SESSION_STATUSES,
  authorizeSheetSession,
  createSheetSession,
  deriveRunExpiry,
  isExpired,
  type SheetGenerationRun,
  type SheetSession,
} from "./index.js";
import {
  FakeClock,
  FakeCrypto,
  InMemorySheetRunRepository,
  InMemorySheetSessionRepository,
} from "./test/fakes.js";

const FIXED_NOW = "2026-09-13T08:00:00.000Z";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

describe("sheet session constants", () => {
  it("lifetime is exactly 120 minutes and distinct from the 12-hour analysis session", () => {
    expect(SHEET_SESSION_LIFETIME_MS).toBe(120 * 60 * 1000);
    expect(SHEET_SESSION_LIFETIME_MS).toBe(7_200_000);
    expect(SHEET_SESSION_LIFETIME_MS).not.toBe(12 * 60 * 60 * 1000);
  });

  it("statuses mirror the ACTIVE/DELETING cleanup convention", () => {
    expect(SHEET_SESSION_STATUSES).toEqual(["ACTIVE", "DELETING"]);
  });

  it("cleanup retry grace is shared with the analysis cleanup convention", () => {
    expect(SHEET_CLEANUP_RETRY_GRACE_MS).toBe(60 * 60 * 1000);
  });
});

describe("run constants", () => {
  it("statuses are the final lifecycle set", () => {
    expect(SHEET_RUN_STATUSES).toEqual([
      "PENDING",
      "READY",
      "FAILED",
      "INVALIDATED",
      "EXPIRED",
    ]);
  });

  it("modes are bounded to pc and npc", () => {
    expect(SHEET_RUN_MODES).toEqual(["pc", "npc"]);
  });

  it("failure codes are bounded and transport-neutral", () => {
    expect(SHEET_RUN_FAILURE_CODES).toEqual([
      "GENERATION_FAILED",
      "INTERNAL_ERROR",
    ]);
  });
});

describe("sheet session creation", () => {
  it("returns the plaintext token exactly once and persists only the hash", async () => {
    const clock = new FakeClock(FIXED_NOW);
    const crypto = new FakeCrypto();
    const repository = new InMemorySheetSessionRepository();

    const result = await createSheetSession({ clock, crypto, repository });

    expect(result.sessionId).toBe("sess-0001");
    expect(result.accessToken.length).toBeGreaterThanOrEqual(32);
    expect(result.expiresAt.getTime() - result.expiresAt.getTime()).toBe(0);

    const stored = (await repository.findById(result.sessionId))!;
    expect(stored).not.toBeNull();
    expect(stored.tokenHash).not.toBe(result.accessToken);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).toBe(
      await hashTokenSha256(result.accessToken, crypto),
    );
    expect(stored.status).toBe("ACTIVE");
    expect(stored.createdAt.getTime()).toBe(clock.now().getTime());
    expect(stored.updatedAt.getTime()).toBe(stored.createdAt.getTime());
  });

  it("expires exactly 120 minutes after creation with a fixed clock", async () => {
    const clock = new FakeClock(FIXED_NOW);
    const crypto = new FakeCrypto();
    const repository = new InMemorySheetSessionRepository();

    const result = await createSheetSession({ clock, crypto, repository });

    expect(result.expiresAt.getTime() - clock.now().getTime()).toBe(
      SHEET_SESSION_LIFETIME_MS,
    );
    const stored = (await repository.findById(result.sessionId))!;
    expect(stored.expiresAt.getTime()).toBe(
      new Date(FIXED_NOW).getTime() + SHEET_SESSION_LIFETIME_MS,
    );
  });

  it("no session stores the plaintext access token anywhere", async () => {
    const deps = {
      clock: new FakeClock(FIXED_NOW),
      crypto: new FakeCrypto(),
      repository: new InMemorySheetSessionRepository(),
    };
    const result = await createSheetSession(deps);
    const stored = (await deps.repository.findById(result.sessionId))!;
    expect(JSON.stringify(stored)).not.toContain(result.accessToken);
  });
});

describe("session authorization", () => {
  async function createSession() {
    const clock = new FakeClock(FIXED_NOW);
    const crypto = new FakeCrypto();
    const repository = new InMemorySheetSessionRepository();
    const result = await createSheetSession({ clock, crypto, repository });
    return { clock, crypto, repository, result };
  }

  it("valid token authorizes", async () => {
    const deps = await createSession();
    const auth = await authorizeSheetSession(
      deps.result.sessionId,
      deps.result.accessToken,
      deps,
    );
    expect(auth).toEqual({
      kind: "ok",
      session: { sessionId: deps.result.sessionId },
    });
  });

  it("wrong token is rejected", async () => {
    const deps = await createSession();
    const auth = await authorizeSheetSession(
      deps.result.sessionId,
      "wrong-token",
      deps,
    );
    expect(auth.kind).toBe("not_found_or_unauthorized");
  });

  it("expired session is rejected with the explicit expired outcome", async () => {
    const deps = await createSession();
    deps.clock.advance(SHEET_SESSION_LIFETIME_MS);
    const atBoundary = await authorizeSheetSession(
      deps.result.sessionId,
      deps.result.accessToken,
      deps,
    );
    expect(atBoundary.kind).toBe("expired");
    deps.clock.advance(1);
    const later = await authorizeSheetSession(
      deps.result.sessionId,
      deps.result.accessToken,
      deps,
    );
    expect(later.kind).toBe("expired");
  });

  it("unknown session is indistinguishable from a wrong token", async () => {
    const deps = await createSession();
    const unknown = await authorizeSheetSession("sess-missing", "x", deps);
    const wrongToken = await authorizeSheetSession(
      deps.result.sessionId,
      "x",
      deps,
    );
    expect(unknown).toEqual(wrongToken);
  });
});

describe("session expiry helpers", () => {
  it("isExpired is boundary-inclusive", () => {
    const session: SheetSession = {
      sessionId: "s",
      tokenHash: "h",
      status: "ACTIVE",
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
      expiresAt: new Date(new Date(FIXED_NOW).getTime() + 1000),
    };
    expect(isExpired(session, new Date(FIXED_NOW))).toBe(false);
    expect(
      isExpired(session, new Date(new Date(FIXED_NOW).getTime() + 1000)),
    ).toBe(true);
  });

  it("deriveRunExpiry inherits the owning session expiresAt", () => {
    const session: SheetSession = {
      sessionId: "s",
      tokenHash: "h",
      status: "ACTIVE",
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
      expiresAt: new Date(
        new Date(FIXED_NOW).getTime() + SHEET_SESSION_LIFETIME_MS,
      ),
    };
    const runExpiry = deriveRunExpiry(session);
    expect(runExpiry.getTime()).toBe(session.expiresAt.getTime());
    expect(runExpiry.getTime() - session.createdAt.getTime()).toBe(
      SHEET_SESSION_LIFETIME_MS,
    );
  });
});

describe("run repository contract (reference implementation)", () => {
  function session(): SheetSession {
    return {
      sessionId: "sess-0001",
      tokenHash: "h",
      status: "ACTIVE",
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
      expiresAt: new Date(
        new Date(FIXED_NOW).getTime() + SHEET_SESSION_LIFETIME_MS,
      ),
    };
  }

  function run(id: string): SheetGenerationRun {
    return {
      runId: id,
      sessionId: "sess-0001",
      analysisId: null,
      rulesAnalysisRunId: null,
      ingestionId: null,
      draftId: null,
      draftVersion: null,
      mode: "pc",
      status: "PENDING",
      failureCode: null,
      isCurrent: true,
      createdAt: new Date(FIXED_NOW),
      updatedAt: new Date(FIXED_NOW),
      expiresAt: deriveRunExpiry(session()),
    };
  }

  it("GUI-only record accepts triple-null rulebook identities", () => {
    const guiOnly = run("run-0001");
    expect(guiOnly.analysisId).toBeNull();
    expect(guiOnly.rulesAnalysisRunId).toBeNull();
    expect(guiOnly.ingestionId).toBeNull();
    expect(guiOnly.mode).toBe("pc");
    expect(guiOnly.status).toBe("PENDING");
  });

  it("repost supersedes: first run current, second invalidates it and becomes current", async () => {
    const repo = new InMemorySheetRunRepository();
    const a = run("run-a");
    const b = run("run-b");
    await repo.createCurrent(a);
    await repo.createCurrent(b);

    const storedA = (await repo.getById("run-a"))!;
    expect(storedA.status).toBe("INVALIDATED");
    expect(storedA.isCurrent).toBe(false);
    const current = (await repo.getCurrentForSession("sess-0001"))!;
    expect(current.runId).toBe("run-b");
    expect(current.status).toBe("PENDING");
    expect(current.isCurrent).toBe(true);
  });

  it("PENDING -> READY and PENDING -> FAILED terminality", async () => {
    const repo = new InMemorySheetRunRepository();
    await repo.createCurrent(run("run-1"));

    const ready = await repo.markReady("run-1", new Date(FIXED_NOW));
    expect(ready.kind).toBe("transitioned");

    const backToFailed = await repo.markFailed(
      "run-1",
      "INTERNAL_ERROR",
      new Date(FIXED_NOW),
    );
    expect(backToFailed.kind).toBe("wrong_state");

    const repo2 = new InMemorySheetRunRepository();
    await repo2.createCurrent(run("run-2"));
    const failed = await repo2.markFailed(
      "run-2",
      "GENERATION_FAILED",
      new Date(FIXED_NOW),
    );
    expect(failed.kind).toBe("transitioned");
    const toReady = await repo2.markReady("run-2", new Date(FIXED_NOW));
    expect(toReady.kind).toBe("wrong_state");
  });

  it("stale invalidated run cannot transition terminally", async () => {
    const repo = new InMemorySheetRunRepository();
    await repo.createCurrent(run("run-a"));
    await repo.createCurrent(run("run-b"));

    const stale = await repo.markReady("run-a", new Date(FIXED_NOW));
    expect(stale.kind).toBe("not_current");
    const staleFailed = await repo.markFailed(
      "run-a",
      "INTERNAL_ERROR",
      new Date(FIXED_NOW),
    );
    expect(staleFailed.kind).toBe("not_current");
    const current = (await repo.getCurrentForSession("sess-0001"))!;
    expect(current.runId).toBe("run-b");
    expect(current.status).toBe("PENDING");
  });

  it("expire applies only to non-terminal PENDING/READY runs", async () => {
    const repo = new InMemorySheetRunRepository();
    await repo.createCurrent(run("run-x"));
    const expired = await repo.expire("run-x", new Date(FIXED_NOW));
    expect(expired.kind).toBe("transitioned");
    const after = (await repo.getById("run-x"))!;
    expect(after.status).toBe("EXPIRED");
    expect(after.isCurrent).toBe(false);
    const again = await repo.expire("run-x", new Date(FIXED_NOW));
    expect(again.kind).toBe("not_current");
  });

  it("cleanup candidates expose sessionId + runId for expired lifetimes", async () => {
    const repo = new InMemorySheetRunRepository();
    const nearFuture = new Date(new Date(FIXED_NOW).getTime() + 60 * 60 * 1000);
    await repo.createCurrent({
      ...run("run-early"),
      expiresAt: nearFuture,
    });
    await repo.createCurrent({
      ...run("run-late"),
      expiresAt: new Date(new Date(FIXED_NOW).getTime() - 60 * 60 * 1000),
    });
    const candidates = await repo.findCleanupCandidates(
      new Date(FIXED_NOW),
      10,
    );
    expect(candidates).toEqual([{ sessionId: "sess-0001", runId: "run-late" }]);
  });
});

describe("lifetimes do not leak to each other", () => {
  it("the 120-minute sheet lifetime is unrelated to the 12-hour analysis constant", () => {
    expect(TWELVE_HOURS_MS).toBe(12 * 60 * 60 * 1000);
    expect(SHEET_SESSION_LIFETIME_MS).not.toBe(TWELVE_HOURS_MS);
  });
});
