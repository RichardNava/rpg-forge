import {
  CLEANUP_RETRY_GRACE_MS,
  type AnalysisSession,
} from "@repo/rules-analysis-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1SessionRepository } from "./repository.js";

const MIGRATION_DDL =
  "CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`);";

function fixedClock(iso: string) {
  return { now: () => new Date(iso) };
}

function makeSession(
  overrides: Partial<AnalysisSession> = {},
): AnalysisSession {
  return {
    analysisId: crypto.randomUUID(),
    tokenHash: "x".repeat(64),
    status: "ACTIVE",
    createdAt: new Date("2026-09-07T10:00:00.000Z"),
    updatedAt: new Date("2026-09-07T10:00:00.000Z"),
    expiresAt: new Date("2026-09-07T22:00:00.000Z"),
    ...overrides,
  };
}

describe("D1 session repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("round-trips create and findById", async () => {
    const repository = createD1SessionRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const session = makeSession();
    await repository.create(session);
    const found = await repository.findById(session.analysisId);
    expect(found).toEqual(session);
  });

  it("returns null for an unknown id", async () => {
    const repository = createD1SessionRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    expect(await repository.findById(crypto.randomUUID())).toBeNull();
  });

  it("marks an active session DELETING and persists the new updatedAt", async () => {
    const before = new Date("2026-09-07T10:00:00.000Z");
    const clock = { now: () => before };
    const repository = createD1SessionRepository(db, { clock });
    const session = makeSession({ status: "ACTIVE" });
    await repository.create(session);
    const transition = await repository.markDeletingIfActive(
      session.analysisId,
    );
    expect(transition).toBe("transitioned");
    const found = await repository.findById(session.analysisId);
    expect(found!.status).toBe("DELETING");
    expect(found!.updatedAt.getTime()).toBe(before.getTime());
  });

  it("is idempotent for a session already DELETING", async () => {
    const repository = createD1SessionRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const session = makeSession({ status: "DELETING" });
    await repository.create(session);
    const transition = await repository.markDeletingIfActive(
      session.analysisId,
    );
    expect(transition).toBe("already_deleting");
  });

  it("returns not_found for an unknown transition target", async () => {
    const repository = createD1SessionRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    expect(await repository.markDeletingIfActive(crypto.randomUUID())).toBe(
      "not_found",
    );
  });

  it("finds expired ACTIVE sessions and stale DELETING sessions", async () => {
    const now = new Date("2026-09-07T22:30:00.000Z");
    const repository = createD1SessionRepository(db, {
      clock: { now: () => now },
    });
    const expired = makeSession({
      expiresAt: new Date("2026-09-07T22:00:00.000Z"),
      status: "ACTIVE",
    });
    const staleDeleting = makeSession({
      status: "DELETING",
      updatedAt: new Date(now.getTime() - CLEANUP_RETRY_GRACE_MS - 1),
    });
    const activeFresh = makeSession({
      expiresAt: new Date("2026-09-07T23:00:00.000Z"),
      status: "ACTIVE",
    });
    const freshDeleting = makeSession({
      status: "DELETING",
      updatedAt: now,
    });
    for (const s of [expired, staleDeleting, activeFresh, freshDeleting]) {
      await repository.create(s);
    }
    const candidates = await repository.findCleanupCandidates(now, 10);
    const ids = candidates.map((c) => c.analysisId);
    expect(ids).toContain(expired.analysisId);
    expect(ids).toContain(staleDeleting.analysisId);
    expect(ids).not.toContain(activeFresh.analysisId);
    expect(ids).not.toContain(freshDeleting.analysisId);
  });

  it("respects the candidate limit", async () => {
    const now = new Date("2026-09-07T22:30:00.000Z");
    const repository = createD1SessionRepository(db, {
      clock: { now: () => now },
    });
    for (let i = 0; i < 5; i++) {
      await repository.create(
        makeSession({ expiresAt: new Date("2026-09-07T21:00:00.000Z") }),
      );
    }
    const candidates = await repository.findCleanupCandidates(now, 2);
    expect(candidates).toHaveLength(2);
  });

  it("deletes a row", async () => {
    const repository = createD1SessionRepository(db, {
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
    });
    const session = makeSession();
    await repository.create(session);
    await repository.delete(session.analysisId);
    expect(await repository.findById(session.analysisId)).toBeNull();
  });
});
