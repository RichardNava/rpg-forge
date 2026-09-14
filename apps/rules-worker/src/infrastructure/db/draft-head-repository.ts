import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
  CreateDraftHeadResult,
  DraftHead,
  DraftHeadClaimResult,
  DraftHeadCommitResult,
  DraftHeadIdentity,
  DraftHeadReleaseResult,
  DraftHeadRepositoryPort,
  DraftHeadStableView,
} from "@repo/character-sheet-session";
import { toDraftHeadStableView } from "@repo/character-sheet-session";
import { sheetDraftHead } from "./schema.js";

/**
 * D1-backed draft-head coordination. Every version mutation is a conditional
 * UPDATE whose WHERE clause carries the guarded row state (committed version,
 * pending version, claim id); the affected-row count decides the outcome. This
 * is real conditional SQL, not application-memory CAS: two concurrent requests
 * can never both advance the same head past the same version.
 *
 * The table stores zero draft content; the R2 snapshot store remains the sole
 * authoritative draft body.
 */
export function createD1DraftHeadRepository(
  database: D1Database,
): DraftHeadRepositoryPort {
  const db = drizzle(database, { schema: { sheetDraftHead } });
  const table = sheetDraftHead;

  async function find(identity: DraftHeadIdentity): Promise<DraftHead | null> {
    const rows = await db
      .select()
      .from(table)
      .where(
        and(
          eq(table.sessionId, identity.sessionId),
          eq(table.draftId, identity.draftId),
        ),
      )
      .limit(1)
      .all();
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  return {
    async create(identity): Promise<CreateDraftHeadResult> {
      const now = new Date();
      const inserted = await db
        .insert(table)
        .values({
          sessionId: identity.sessionId,
          draftId: identity.draftId,
          currentVersion: 1,
          pendingVersion: null,
          pendingClaimId: null,
          pendingSince: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      const head = await find(identity);
      if (head === null) {
        throw new Error("draft-head create failed without an existing row");
      }
      return inserted.meta.changes > 0
        ? { kind: "created", head }
        : { kind: "already_exists", head };
    },

    async getHead(identity): Promise<DraftHead | null> {
      return find(identity);
    },

    async getStable(identity): Promise<DraftHeadStableView | null> {
      const head = await find(identity);
      return head === null ? null : toDraftHeadStableView(head);
    },

    async claim(
      identity,
      expectedVersion,
      claimId,
      claimsAt,
    ): Promise<DraftHeadClaimResult> {
      const claimedVersion = expectedVersion + 1;
      const attempted = await db
        .update(table)
        .set({
          pendingVersion: claimedVersion,
          pendingClaimId: claimId,
          pendingSince: claimsAt,
          updatedAt: claimsAt,
        })
        .where(
          and(
            eq(table.sessionId, identity.sessionId),
            eq(table.draftId, identity.draftId),
            eq(table.currentVersion, expectedVersion),
            isNull(table.pendingVersion),
          ),
        )
        .run();
      const head = await find(identity);
      if (attempted.meta.changes > 0) {
        return { kind: "claimed", head: head!, claimedVersion };
      }
      if (head === null) {
        return { kind: "not_found" };
      }
      if (head.pendingVersion !== null) {
        return { kind: "already_pending", head };
      }
      return { kind: "version_conflict", head };
    },

    async commit(
      identity,
      claimId,
      expectedCurrentVersion,
      committedAt,
    ): Promise<DraftHeadCommitResult> {
      const committedVersion = expectedCurrentVersion + 1;
      const attempted = await db
        .update(table)
        .set({
          currentVersion: committedVersion,
          pendingVersion: null,
          pendingClaimId: null,
          pendingSince: null,
          updatedAt: committedAt,
        })
        .where(
          and(
            eq(table.sessionId, identity.sessionId),
            eq(table.draftId, identity.draftId),
            eq(table.currentVersion, expectedCurrentVersion),
            eq(table.pendingVersion, committedVersion),
            eq(table.pendingClaimId, claimId),
          ),
        )
        .run();
      const head = await find(identity);
      if (attempted.meta.changes > 0) {
        return { kind: "committed", head: head! };
      }
      if (head === null) {
        return { kind: "not_found" };
      }
      if (
        head.pendingClaimId !== claimId ||
        head.pendingVersion !== committedVersion
      ) {
        return { kind: "wrong_claim", head };
      }
      return { kind: "version_conflict", head };
    },

    async release(
      identity,
      claimId,
      versionToRelease,
      releasedAt,
    ): Promise<DraftHeadReleaseResult> {
      const attempted = await db
        .update(table)
        .set({
          pendingVersion: null,
          pendingClaimId: null,
          pendingSince: null,
          updatedAt: releasedAt,
        })
        .where(
          and(
            eq(table.sessionId, identity.sessionId),
            eq(table.draftId, identity.draftId),
            eq(table.pendingClaimId, claimId),
            eq(table.pendingVersion, versionToRelease),
          ),
        )
        .run();
      const head = await find(identity);
      if (attempted.meta.changes > 0) {
        return { kind: "released", head: head! };
      }
      if (head === null) {
        return { kind: "not_found" };
      }
      return { kind: "wrong_claim", head };
    },

    async findStalePending(now, staleAfterMs, limit): Promise<DraftHead[]> {
      const cutoff = new Date(now.getTime() - staleAfterMs);
      const rows = await db
        .select()
        .from(table)
        .where(
          and(isNotNull(table.pendingVersion), lte(table.pendingSince, cutoff)),
        )
        .orderBy(table.pendingSince)
        .limit(limit)
        .all();
      return rows.map(fromRow);
    },

    async deleteSessionHeads(sessionId): Promise<void> {
      await db.delete(table).where(eq(table.sessionId, sessionId)).run();
    },
  };
}

function fromRow(row: typeof sheetDraftHead.$inferSelect): DraftHead {
  return {
    sessionId: row.sessionId,
    draftId: row.draftId,
    currentVersion: row.currentVersion,
    pendingVersion: row.pendingVersion,
    pendingClaimId: row.pendingClaimId,
    pendingSince:
      row.pendingSince === null ? null : new Date(row.pendingSince.getTime()),
    createdAt: new Date(row.createdAt.getTime()),
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}
