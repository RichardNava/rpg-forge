/**
 * 4E5 — scheduled stale draft-claim recovery wiring.
 *
 * Proves `recoverStaleSheetDraftClaims` resolves both recovery outcomes
 * through the real V2 store adapter: a pending snapshot that exists is
 * committed, and a missing snapshot releases the stale claim. Neither path
 * deletes an R2 snapshot.
 */
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  getDraftSnapshotKey,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import { createR2CharacterSheetDraftStoreV2 } from "./infrastructure/r2-character-sheet-drafts-v2.js";
import type { R2BucketLike } from "./infrastructure/r2-character-sheet-artifacts.js";
import { FakeClock, FakeDraftHeadRepository } from "./test/fakes.js";
import { recoverStaleSheetDraftClaims } from "./scheduled-draft-recovery.js";

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT_ID = "d8f2b0c1-3a4e-4f6b-9c1d-2e3a4b5c6d7e";
const IDENTITY = { sessionId: SESSION_ID, draftId: DRAFT_ID };

class MemoryBucket implements R2BucketLike {
  readonly objects = new Map<string, string>();

  seed(key: string, payload: string): void {
    this.objects.set(key, payload);
  }

  async put(key: string, value: string | Uint8Array): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? value : new TextDecoder().decode(value),
    );
    return undefined;
  }

  async get(key: string): Promise<{
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
  } | null> {
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

  async delete(): Promise<void> {
    // Recovery never deletes snapshots; the sweep owns deletion.
  }
}

function makeDraft(version: number): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId: DRAFT_ID,
    sessionId: SESSION_ID,
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
    sections: [],
    structure: [{ kind: "field", key: "character_name", parentKey: null }],
    values: { character_name: "Aria Stone" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

const NOW = new Date("2026-03-01T10:05:00.000Z");
const STALE_AT = new Date(NOW.getTime() - 120_000);

async function staleClaimedHeads(): Promise<FakeDraftHeadRepository> {
  const heads = new FakeDraftHeadRepository();
  await heads.create(IDENTITY);
  const claimed = await heads.claim(IDENTITY, 1, "claim-1", STALE_AT);
  expect(claimed.kind).toBe("claimed");
  return heads;
}

describe("recoverStaleSheetDraftClaims (scheduled)", () => {
  it("commits the stale head when the pending R2 snapshot exists", async () => {
    const bucket = new MemoryBucket();
    const store = createR2CharacterSheetDraftStoreV2(bucket);
    const pending = makeDraft(2);
    bucket.seed(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
      JSON.stringify(pending),
    );
    const heads = await staleClaimedHeads();

    await recoverStaleSheetDraftClaims({
      clock: new FakeClock(NOW.toISOString()),
      sheetDraftHeadRepository: heads,
      sheetDraftStoreV2: store,
    });

    const head = await heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(2);
    expect(head?.pendingVersion).toBeNull();
    expect(
      bucket.objects.has(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2)),
    ).toBe(true);
  });

  it("releases the stale claim when the pending snapshot is absent", async () => {
    const bucket = new MemoryBucket();
    const store = createR2CharacterSheetDraftStoreV2(bucket);
    const heads = await staleClaimedHeads();

    await recoverStaleSheetDraftClaims({
      clock: new FakeClock(NOW.toISOString()),
      sheetDraftHeadRepository: heads,
      sheetDraftStoreV2: store,
    });

    const head = await heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(1);
    expect(head?.pendingVersion).toBeNull();
    expect(head?.pendingClaimId).toBeNull();
  });

  it("skips recovery when the V2 store binding is unavailable", async () => {
    const heads = await staleClaimedHeads();

    await recoverStaleSheetDraftClaims({
      clock: new FakeClock(NOW.toISOString()),
      sheetDraftHeadRepository: heads,
    });

    const head = await heads.getHead(IDENTITY);
    expect(head?.pendingVersion).toBe(2);
  });
});
