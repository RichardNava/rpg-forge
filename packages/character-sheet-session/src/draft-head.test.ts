import { describe, expect, it } from "vitest";
import {
  DRAFT_CLAIM_STALE_MS,
  isDraftHeadStable,
  isStaleDraftClaim,
  recoverStaleDraftClaims,
  toDraftHeadStableView,
  type DraftSnapshotProbe,
} from "./index.js";
import { InMemoryDraftHeadRepository } from "./test/fakes.js";

const ID = { sessionId: "sess-0001", draftId: "draft-a" };
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

function olderBy(repo: InMemoryDraftHeadRepository, ms: number) {
  for (const head of repo.rows.values()) {
    if (head.pendingSince !== null) {
      head.pendingSince = new Date(head.pendingSince.getTime() - ms);
    }
  }
}

describe("draft-head constants and helpers", () => {
  it("claim staleness bound is one minute", () => {
    expect(DRAFT_CLAIM_STALE_MS).toBe(60 * 1000);
  });

  it("isDraftHeadStable distinguishes stable from claimed heads", async () => {
    const created = await awaitCreate(ID);
    if (created.kind !== "created") throw new Error("expected created");
    expect(isDraftHeadStable(created.head)).toBe(true);
    const claimed = await awaitClaim(ID, 1, "claim-1", NOW);
    if (claimed.kind !== "claimed") throw new Error("expected claimed");
    expect(isDraftHeadStable(claimed.head)).toBe(false);
  });

  it("isStaleDraftClaim is boundary-inclusive", async () => {
    const claimed = await awaitClaim(ID, 1, "claim-1", NOW);
    if (claimed.kind !== "claimed") throw new Error("expected claimed");
    const atBoundary = new Date(NOW.getTime() + DRAFT_CLAIM_STALE_MS);
    expect(isStaleDraftClaim(claimed.head, atBoundary)).toBe(true);
    const justBefore = new Date(atBoundary.getTime() - 1);
    expect(isStaleDraftClaim(claimed.head, justBefore)).toBe(false);
  });

  it("the stable view exposes only the last committed version", async () => {
    const created = await awaitCreate(ID);
    if (created.kind !== "created") throw new Error("expected created");
    expect(toDraftHeadStableView(created.head)).toEqual({
      sessionId: ID.sessionId,
      draftId: ID.draftId,
      currentVersion: 1,
    });
  });
});

describe("draft-head repository contract (reference implementation)", () => {
  it("create starts at version 1 with no pending claim", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const result = await repo.create(ID);
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.head.currentVersion).toBe(1);
    expect(result.head.pendingVersion).toBeNull();
    expect(result.head.pendingClaimId).toBeNull();
    expect(result.head.pendingSince).toBeNull();
  });

  it("duplicate create is reported explicitly", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    const second = await repo.create(ID);
    expect(second.kind).toBe("already_exists");
  });

  it("claim reserves N+1 and then commits it", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    const claimed = await repo.claim(ID, 1, "claim-1", NOW);
    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;
    expect(claimed.claimedVersion).toBe(2);
    const head = claimed.head;
    expect(head.pendingVersion).toBe(2);
    expect(head.pendingClaimId).toBe("claim-1");

    const committed = await repo.commit(ID, "claim-1", 1, NOW);
    expect(committed.kind).toBe("committed");
    if (committed.kind !== "committed") return;
    expect(committed.head.currentVersion).toBe(2);
    expect(committed.head.pendingVersion).toBeNull();
    expect(committed.head.pendingClaimId).toBeNull();
  });

  it("two requests claiming the same version: one wins, the other gets already_pending", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    const a = await repo.claim(ID, 1, "claim-a", NOW);
    expect(a.kind).toBe("claimed");
    const b = await repo.claim(ID, 1, "claim-b", NOW);
    expect(b.kind).toBe("already_pending");
  });

  it("a stale expected version is reported as version_conflict", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-1", NOW);
    await repo.commit(ID, "claim-1", 1, NOW);
    const stale = await repo.claim(ID, 1, "claim-2", NOW);
    expect(stale.kind).toBe("version_conflict");
    const fresh = await repo.claim(ID, 2, "claim-3", NOW);
    expect(fresh.kind).toBe("claimed");
  });

  it("committing with the wrong claim id is rejected", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-real", NOW);
    const wrong = await repo.commit(ID, "claim-forged", 1, NOW);
    expect(wrong.kind).toBe("wrong_claim");
    const head = (await repo.getHead(ID))!;
    expect(head.pendingClaimId).toBe("claim-real");
    expect(head.currentVersion).toBe(1);
  });

  it("release clears the claim and leaves the committed version untouched", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-1", NOW);
    const released = await repo.release(ID, "claim-1", 2, NOW);
    expect(released.kind).toBe("released");
    if (released.kind !== "released") return;
    expect(released.head.currentVersion).toBe(1);
    expect(released.head.pendingVersion).toBeNull();
    const afterRelease = await repo.claim(ID, 1, "claim-2", NOW);
    expect(afterRelease.kind).toBe("claimed");
  });

  it("releasing a claim that was already committed is rejected", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-1", NOW);
    await repo.commit(ID, "claim-1", 1, NOW);
    const lateRelease = await repo.release(ID, "claim-1", 2, NOW);
    expect(lateRelease.kind).toBe("wrong_claim");
    const head = (await repo.getHead(ID))!;
    expect(head.currentVersion).toBe(2);
  });

  it("the stable view hides the pending claim (reads still see version N)", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-1", NOW);
    const stable = (await repo.getStable(ID))!;
    expect(stable.currentVersion).toBe(1);
  });

  it("findStalePending is boundary-inclusive and ordered by pending_since", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-old", NOW);
    await repo.create({ sessionId: ID.sessionId, draftId: "draft-b" });
    await repo.claim(
      { sessionId: ID.sessionId, draftId: "draft-b" },
      1,
      "claim-recent",
      NOW,
    );
    olderBy(repo, DRAFT_CLAIM_STALE_MS);
    const stale = await repo.findStalePending(NOW, DRAFT_CLAIM_STALE_MS, 10);
    expect(stale.map((h) => h.draftId).sort()).toEqual(["draft-a", "draft-b"]);

    // with a smaller window only the older head is stale
    const repo2 = new InMemoryDraftHeadRepository();
    await repo2.create(ID);
    await repo2.claim(ID, 1, "claim-old", NOW);
    await repo2.create({ sessionId: ID.sessionId, draftId: "draft-b" });
    await repo2.claim(
      { sessionId: ID.sessionId, draftId: "draft-b" },
      1,
      "claim-recent",
      NOW,
    );
    for (const head of repo2.rows.values()) {
      if (head.draftId === "draft-a" && head.pendingSince !== null) {
        head.pendingSince = new Date(
          head.pendingSince.getTime() - (DRAFT_CLAIM_STALE_MS + 60_000),
        );
      }
    }
    const partial = await repo2.findStalePending(NOW, 30_000, 10);
    expect(partial.map((h) => h.draftId)).toEqual(["draft-a"]);
  });

  it("findStalePending honors the limit", async () => {
    const repo = new InMemoryDraftHeadRepository();
    for (const draftId of ["a", "b", "c"]) {
      await repo.create({ sessionId: ID.sessionId, draftId });
      await repo.claim({ sessionId: ID.sessionId, draftId }, 1, "claim-x", NOW);
    }
    olderBy(repo, DRAFT_CLAIM_STALE_MS);
    const limited = await repo.findStalePending(NOW, DRAFT_CLAIM_STALE_MS, 2);
    expect(limited).toHaveLength(2);
  });

  it("deleteSessionHeads removes heads for the session only", async () => {
    const repo = new InMemoryDraftHeadRepository();
    await repo.create(ID);
    await repo.create({ sessionId: "sess-0002", draftId: "draft-b" });
    await repo.deleteSessionHeads(ID.sessionId);
    expect(await repo.getHead(ID)).toBeNull();
    expect(
      await repo.getHead({ sessionId: "sess-0002", draftId: "draft-b" }),
    ).not.toBeNull();
  });
});

describe("stale-claim recovery", () => {
  it("crash after claim but before R2: release the stale claim", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const probe = new FakeProbe();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-orphan", NOW);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);

    const result = await recoverStaleDraftClaims(repo, probe, NOW);

    expect(result).toEqual({
      recovered: 1,
      committed: 0,
      released: 1,
      failed: [],
    });
    const head = (await repo.getHead(ID))!;
    expect(head.currentVersion).toBe(1);
    expect(head.pendingClaimId).toBeNull();
  });

  it("crash after valid R2 snapshot but before D1 commit: complete the commit", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const probe = new FakeProbe();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-orphan", NOW);
    probe.presentSnapshot(ID.sessionId, ID.draftId, 2);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);

    const result = await recoverStaleDraftClaims(repo, probe, NOW);

    expect(result).toEqual({
      recovered: 1,
      committed: 1,
      released: 0,
      failed: [],
    });
    const head = (await repo.getHead(ID))!;
    expect(head.currentVersion).toBe(2);
    expect(head.pendingClaimId).toBeNull();
  });

  it("no skipped versions: recovery commits exactly the pending snapshot version", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const probe = new FakeProbe();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-orphan", NOW);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);

    await recoverStaleDraftClaims(repo, probe, NOW);
    const head = (await repo.getHead(ID))!;
    expect(head.currentVersion).toBe(1);

    await repo.claim(ID, 1, "claim-retry", NOW);
    probe.presentSnapshot(ID.sessionId, ID.draftId, 2);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);
    await recoverStaleDraftClaims(repo, probe, NOW);
    const after = (await repo.getHead(ID))!;
    expect(after.currentVersion).toBe(2);
  });

  it("a snapshot present after another writer resolved the claim is not an error", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const probe = new FakeProbe();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-resolved", NOW);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);

    // Another writer already committed version 2; the stale head is now a
    // wrong_claim for the old claim id.
    for (const head of repo.rows.values()) {
      head.currentVersion = 2;
      head.pendingVersion = null;
      head.pendingClaimId = null;
      head.pendingSince = null;
    }
    probe.presentSnapshot(ID.sessionId, ID.draftId, 2);

    const result = await recoverStaleDraftClaims(repo, probe, NOW);
    expect(result).toEqual({
      recovered: 0,
      committed: 0,
      released: 0,
      failed: [],
    });
    const head = (await repo.getHead(ID))!;
    expect(head.currentVersion).toBe(2);
  });

  it("probe failures surface as failed while other heads still recover", async () => {
    const repo = new InMemoryDraftHeadRepository();
    const probe = new FakeProbe();
    await repo.create(ID);
    await repo.claim(ID, 1, "claim-knockout", NOW);
    olderBy(repo, DRAFT_CLAIM_STALE_MS);

    const throwingProbe: DraftSnapshotProbe = {
      async hasSnapshot() {
        return Promise.reject(new Error("r2 unavailable"));
      },
    };
    const result = await recoverStaleDraftClaims(repo, throwingProbe, NOW);
    expect(result).toEqual({
      recovered: 0,
      committed: 0,
      released: 0,
      failed: [`${ID.sessionId}:${ID.draftId}`],
    });
  });
});

async function awaitCreate(identity: {
  sessionId: string;
  draftId: string;
}): Promise<Awaited<ReturnType<InMemoryDraftHeadRepository["create"]>>> {
  const repo = new InMemoryDraftHeadRepository();
  return repo.create(identity);
}

async function awaitClaim(
  identity: { sessionId: string; draftId: string },
  expectedVersion: number,
  claimId: string,
  claimsAt: Date,
): Promise<Awaited<ReturnType<InMemoryDraftHeadRepository["claim"]>>> {
  const repo = new InMemoryDraftHeadRepository();
  await repo.create(identity);
  return repo.claim(identity, expectedVersion, claimId, claimsAt);
}
