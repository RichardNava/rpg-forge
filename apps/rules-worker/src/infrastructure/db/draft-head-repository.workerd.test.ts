import {
  DRAFT_CLAIM_STALE_MS,
  recoverStaleDraftClaims,
  type DraftSnapshotProbe,
} from "@repo/character-sheet-session";
import { type CharacterSheetDraft } from "@repo/character-sheet-draft";
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createR2CharacterSheetDraftStore } from "../r2-character-sheet-drafts.js";
import { createD1DraftHeadRepository } from "./draft-head-repository.js";

const MIGRATION_DDL =
  "CREATE TABLE IF NOT EXISTS `sheet_draft_heads` (`session_id` text NOT NULL, `draft_id` text NOT NULL, `current_version` integer NOT NULL, `pending_version` integer, `pending_claim_id` text, `pending_since` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`session_id`,`draft_id`)); CREATE INDEX IF NOT EXISTS `sheet_draft_heads_session_idx` ON `sheet_draft_heads` (`session_id`); CREATE INDEX IF NOT EXISTS `sheet_draft_heads_pending_idx` ON `sheet_draft_heads` (`pending_version`,`pending_since`);";

const IDENTITY = { sessionId: "sess-0001", draftId: "draft-a" };
const NOW = new Date("2026-09-13T09:00:00.000Z");

class FakeProbe implements DraftSnapshotProbe {
  private present: string[] = [];
  presentSnapshot(sessionId: string, draftId: string, version: number): void {
    this.present.push(`${sessionId}:${draftId}:${version}`);
  }
  async hasSnapshot(
    identity: { sessionId: string; draftId: string },
    version: number,
  ): Promise<boolean> {
    return this.present.includes(
      `${identity.sessionId}:${identity.draftId}:${version}`,
    );
  }
}

function makeValidDraft(
  sessionId: string,
  draftId: string,
  version: number,
): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId,
    sessionId,
    baseVersion: 1,
    version,
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
    ],
    values: { character_name: "Aria Stone" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

describe("D1 draft-head repository", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  beforeEach(async () => {
    await db.exec("DELETE FROM sheet_draft_heads");
  });

  it("creates a head at version 1 with no pending claim", async () => {
    const repo = createD1DraftHeadRepository(db);
    const created = await repo.create(IDENTITY);
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    expect(created.head.currentVersion).toBe(1);
    expect(created.head.pendingClaimId).toBeNull();
    expect(created.head.pendingVersion).toBeNull();
  });

  it("duplicate creation is reported without changing the row", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    const second = await repo.create(IDENTITY);
    expect(second.kind).toBe("already_exists");
    if (second.kind !== "already_exists") return;
    expect(second.head.currentVersion).toBe(1);
  });

  it("claims N -> N+1 only when the head is stable at N", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    const claimed = await repo.claim(IDENTITY, 1, "claim-1", NOW);
    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;
    expect(claimed.claimedVersion).toBe(2);
    expect(claimed.head.pendingVersion).toBe(2);
    expect(claimed.head.pendingClaimId).toBe("claim-1");
    expect(claimed.head.currentVersion).toBe(1);
  });

  it("two concurrent claims for the same version: exactly one wins", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    const [a, b] = await Promise.all([
      repo.claim(IDENTITY, 1, "claim-a", NOW),
      repo.claim(IDENTITY, 1, "claim-b", NOW),
    ]);
    const winners = [a, b].filter((r) => r.kind === "claimed");
    const losers = [a, b].filter((r) => r.kind === "already_pending");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const head = (await repo.getHead(IDENTITY))!;
    expect(head.pendingClaimId).toBe(
      winners[0]!.kind === "claimed" ? winners[0]!.head.pendingClaimId : null,
    );
    expect(head.currentVersion).toBe(1);
  });

  it("claiming with the wrong expected version is a version_conflict", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-1", NOW);
    await repo.commit(IDENTITY, "claim-1", 1, NOW);
    const stale = await repo.claim(IDENTITY, 1, "claim-2", NOW);
    expect(stale.kind).toBe("version_conflict");
  });

  it("commits an owned claim and clears the pending state atomically", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-1", NOW);
    const committed = await repo.commit(IDENTITY, "claim-1", 1, NOW);
    expect(committed.kind).toBe("committed");
    if (committed.kind !== "committed") return;
    expect(committed.head.currentVersion).toBe(2);
    expect(committed.head.pendingVersion).toBeNull();
    expect(committed.head.pendingClaimId).toBeNull();
  });

  it("rejects a commit from the wrong claim id", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-real", NOW);
    const forged = await repo.commit(IDENTITY, "claim-forged", 1, NOW);
    expect(forged.kind).toBe("wrong_claim");
    const head = (await repo.getHead(IDENTITY))!;
    expect(head.pendingClaimId).toBe("claim-real");
    expect(head.currentVersion).toBe(1);
  });

  it("release clears the claim and leaves the committed version untouched", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-1", NOW);
    const released = await repo.release(IDENTITY, "claim-1", 2, NOW);
    expect(released.kind).toBe("released");
    if (released.kind !== "released") return;
    expect(released.head.currentVersion).toBe(1);
    expect(released.head.pendingClaimId).toBeNull();
    const retried = await repo.claim(IDENTITY, 1, "claim-2", NOW);
    expect(retried.kind).toBe("claimed");
  });

  it("the stable view never exposes the pending version", async () => {
    const repo = createD1DraftHeadRepository(db);
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-1", NOW);
    const stable = await repo.getStable(IDENTITY);
    expect(stable!.currentVersion).toBe(1);
    expect("pendingVersion" in stable!).toBe(false);
  });

  it("findStalePending returns claimed heads older than the bound, honoring limit", async () => {
    const repo = createD1DraftHeadRepository(db);
    const second = { sessionId: "sess-0001", draftId: "draft-b" };
    await repo.create(IDENTITY);
    await repo.create(second);
    await repo.claim(IDENTITY, 1, "claim-1", NOW);
    await repo.claim(second, 1, "claim-2", NOW);
    await db
      .prepare(
        "UPDATE sheet_draft_heads SET pending_since = ?1 WHERE session_id = ?2 AND draft_id = ?3",
      )
      .bind(
        NOW.getTime() - DRAFT_CLAIM_STALE_MS - 1000,
        IDENTITY.sessionId,
        IDENTITY.draftId,
      )
      .run();
    const stale = await repo.findStalePending(NOW, DRAFT_CLAIM_STALE_MS, 10);
    expect(stale.map((h) => h.draftId)).toEqual(["draft-a"]);
    const limited = await repo.findStalePending(NOW, DRAFT_CLAIM_STALE_MS, 0);
    expect(limited).toHaveLength(0);
  });

  it("deleteSessionHeads removes heads for that session only", async () => {
    const repo = createD1DraftHeadRepository(db);
    const other = { sessionId: "sess-0002", draftId: "draft-b" };
    await repo.create(IDENTITY);
    await repo.create(other);
    await repo.deleteSessionHeads(IDENTITY.sessionId);
    expect(await repo.getHead(IDENTITY)).toBeNull();
    expect(await repo.getHead(other)).not.toBeNull();
  });
});

describe("stale-claim recovery against real D1 (14.7D coordination)", () => {
  let db: D1Database;
  let repo: ReturnType<typeof createD1DraftHeadRepository>;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
    repo = createD1DraftHeadRepository(db);
  });

  beforeEach(async () => {
    await db.exec("DELETE FROM sheet_draft_heads");
  });

  function ageHead(sessionId: string, draftId: string) {
    return db
      .prepare(
        "UPDATE sheet_draft_heads SET pending_since = ?1 WHERE session_id = ?2 AND draft_id = ?3",
      )
      .bind(NOW.getTime() - DRAFT_CLAIM_STALE_MS - 1000, sessionId, draftId)
      .run();
  }

  it("crash after claim but before R2: recovery releases the stale claim", async () => {
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-orphan", NOW);
    await ageHead(IDENTITY.sessionId, IDENTITY.draftId);

    const result = await recoverStaleDraftClaims(repo, new FakeProbe(), NOW);

    expect(result.released).toBe(1);
    expect(result.committed).toBe(0);
    const head = (await repo.getHead(IDENTITY))!;
    expect(head.currentVersion).toBe(1);
    expect(head.pendingClaimId).toBeNull();
  });

  it("crash after valid R2 snapshot but before D1 commit: recovery commits it", async () => {
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-orphan", NOW);
    await ageHead(IDENTITY.sessionId, IDENTITY.draftId);

    const probe = new FakeProbe();
    probe.presentSnapshot(IDENTITY.sessionId, IDENTITY.draftId, 2);
    const result = await recoverStaleDraftClaims(repo, probe, NOW);

    expect(result.committed).toBe(1);
    expect(result.released).toBe(0);
    const head = (await repo.getHead(IDENTITY))!;
    expect(head.currentVersion).toBe(2);
    expect(head.pendingClaimId).toBeNull();
  });

  it("no skipped versions: the commit advances by exactly one", async () => {
    await repo.create(IDENTITY);
    await repo.claim(IDENTITY, 1, "claim-orphan", NOW);
    await ageHead(IDENTITY.sessionId, IDENTITY.draftId);

    const probe = new FakeProbe();
    probe.presentSnapshot(IDENTITY.sessionId, IDENTITY.draftId, 2);
    await recoverStaleDraftClaims(repo, probe, NOW);
    const head = (await repo.getHead(IDENTITY))!;
    expect(head.currentVersion).toBe(2);
  });

  it("end-to-end with the real R2 draft store as the snapshot authority", async () => {
    const bucket = env.SHEET_ARTIFACTS as R2Bucket | undefined;
    if (bucket === undefined) {
      throw new Error("SHEET_ARTIFACTS binding is missing");
    }
    const draftStore = createR2CharacterSheetDraftStore(bucket);
    const identity = { sessionId: "sess-r2", draftId: "draft-r2" };
    await repo.create(identity);
    await repo.claim(identity, 1, "claim-r2", NOW);
    await ageHead(identity.sessionId, identity.draftId);

    const probe: DraftSnapshotProbe = {
      async hasSnapshot(head, version) {
        return (await draftStore.getDraftVersion(head, version)) !== null;
      },
    };

    // No snapshot present -> release.
    const without = await recoverStaleDraftClaims(repo, probe, NOW);
    expect(without.released).toBe(1);
    const afterRelease = (await repo.getHead(identity))!;
    expect(afterRelease.currentVersion).toBe(1);
    expect(afterRelease.pendingClaimId).toBeNull();

    // Snapshot present -> commit version 2.
    await draftStore.putDraft(
      makeValidDraft(identity.sessionId, identity.draftId, 2),
    );
    await repo.claim(identity, 1, "claim-r2b", NOW);
    await ageHead(identity.sessionId, identity.draftId);
    const withSnapshot = await recoverStaleDraftClaims(repo, probe, NOW);
    expect(withSnapshot.committed).toBe(1);
    const head = (await repo.getHead(identity))!;
    expect(head.currentVersion).toBe(2);
  });
});
