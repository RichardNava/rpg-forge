/**
 * 4E3B3 — focused tests for the V2 reroll orchestration.
 *
 * These exercise the REAL `createR2CharacterSheetDraftStoreV2` adapter over a
 * deterministic in-memory bucket, plus the existing `FakeDraftHeadRepository`,
 * plus the actual `rerollLockedDraftValuesV2` domain function.
 *
 * Nothing here touches a route or HTTP transport parsing.
 */
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  DraftError,
  getDraftSnapshotKey,
  type CharacterSheetDraftV2,
  rerollLockedDraftValuesV2,
} from "@repo/character-sheet-draft";
import type { DraftHead } from "@repo/character-sheet-session";
import { describe, expect, it } from "vitest";
import type { R2BucketLike } from "../../infrastructure/r2-character-sheet-artifacts.js";
import { createR2CharacterSheetDraftStoreV2 } from "../../infrastructure/r2-character-sheet-drafts-v2.js";
import {
  FakeClock,
  FakeCrypto,
  FakeDraftHeadRepository,
} from "../../test/fakes.js";
import { rerollDraftV2 } from "./draft-v2-reroll.js";
import type { DraftV2Runtime } from "./draft-v2-runtime.js";

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT_ID = "d8f2b0c1-3a4e-4f6b-9c1d-2e3a4b5c6d7e";
const IDENTITY = { sessionId: SESSION_ID, draftId: DRAFT_ID };
const CLOCK_ISO = "2026-03-01T10:00:00.000Z";

/**
 * In-memory bucket that records every call. `putKeys` proves zero writes.
 */
class RecordingBucket implements R2BucketLike {
  readonly objects = new Map<string, string>();
  readonly putKeys: string[] = [];
  readonly getKeys: string[] = [];
  failNextPut = false;
  failNextGet = false;

  seed(key: string, payload: string): void {
    this.objects.set(key, payload);
  }

  async put(key: string, value: string | Uint8Array): Promise<unknown> {
    this.putKeys.push(key);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("r2 put unavailable");
    }
    this.objects.set(
      key,
      typeof value === "string" ? value : new TextDecoder().decode(value),
    );
    return undefined;
  }

  async putInitialDraftIfAbsent(
    key: string,
    value: string | Uint8Array,
  ): Promise<unknown | null> {
    if (this.objects.has(key)) {
      return null;
    }
    return this.put(key, value);
  }

  async get(key: string): Promise<{
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
  } | null> {
    this.getKeys.push(key);
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("r2 get unavailable");
    }
    const payload = this.objects.get(key);
    if (payload === undefined) return null;
    const body = payload;
    return {
      text: async () => body,
      bytes: async () => new TextEncoder().encode(body),
    };
  }

  async list(): Promise<{ objects: { key: string }[]; truncated: boolean }> {
    return {
      objects: [...this.objects.keys()].map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(): Promise<void> {
    for (const key of [...this.objects.keys()]) this.objects.delete(key);
  }
}

function makeDraftV2(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId: DRAFT_ID,
    sessionId: SESSION_ID,
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
      { key: "A", label: "A", type: "number", min: 1, max: 6, locked: true },
      { key: "B", label: "B", type: "number", min: 1, max: 6, locked: true },
      { key: "C", label: "C", type: "text", locked: true },
    ],
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "A", parentKey: null },
      { kind: "field", key: "B", parentKey: null },
      { kind: "field", key: "C", parentKey: null },
    ],
    values: { character_name: "Aria Stone", A: 3, B: 4, C: "locked text" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

function makeVersionedDraft(
  version: number,
  baseVersion: number,
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  return makeDraftV2({ version, baseVersion, ...overrides });
}

function seedV2(
  bucket: RecordingBucket,
  draft: CharacterSheetDraftV2,
): CharacterSheetDraftV2 {
  bucket.seed(
    getDraftSnapshotKey(draft.sessionId, draft.draftId, draft.version),
    JSON.stringify(draft),
  );
  return draft;
}

function makeHead(overrides: Partial<DraftHead> = {}): DraftHead {
  const now = new Date(CLOCK_ISO);
  return {
    ...IDENTITY,
    currentVersion: 1,
    pendingVersion: null,
    pendingClaimId: null,
    pendingSince: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface Harness {
  deps: DraftV2Runtime;
  bucket: RecordingBucket;
  heads: FakeDraftHeadRepository;
  events: string[];
}

function makeHarness(head: DraftHead | null = makeHead()): Harness {
  const bucket = new RecordingBucket();
  const store = createR2CharacterSheetDraftStoreV2(bucket);
  const heads = new FakeDraftHeadRepository();
  if (head !== null) {
    heads.rows.set(`${SESSION_ID}:${DRAFT_ID}`, head);
  }
  const events: string[] = [];

  const deps: DraftV2Runtime = {
    clock: new FakeClock(CLOCK_ISO),
    crypto: new FakeCrypto(),
    heads: {
      create: (identity) => heads.create(identity),
      getHead: (identity) => heads.getHead(identity),
      getStable: (identity) => heads.getStable(identity),
      findStalePending: (now, staleAfterMs, limit) =>
        heads.findStalePending(now, staleAfterMs, limit),
      deleteSessionHeads: (sessionId) => heads.deleteSessionHeads(sessionId),
      claim: (identity, expectedVersion, claimId, claimsAt) => {
        events.push("claim");
        return heads.claim(identity, expectedVersion, claimId, claimsAt);
      },
      commit: (identity, claimId, expected, committedAt) => {
        events.push("commit");
        return heads.commit(identity, claimId, expected, committedAt);
      },
      release: (identity, claimId, version, releasedAt) => {
        events.push("release");
        return heads.release(identity, claimId, version, releasedAt);
      },
    },
    store: {
      putInitialDraftIfAbsent: (draft) => store.putInitialDraftIfAbsent(draft),
      putDraft: async (draft) => {
        events.push("put");
        return store.putDraft(draft);
      },
      getDraftVersion: (identity, version) =>
        store.getDraftVersion(identity, version),
      getLatestDraft: (identity) => store.getLatestDraft(identity),
      listDraftVersions: (identity) => store.listDraftVersions(identity),
      deleteDraft: (identity) => store.deleteDraft(identity),
    },
  };

  return { deps, bucket, heads, events };
}

async function errorCodeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DraftError) return error.code;
    return `non-draft-error:${String(error)}`;
  }
  return "no-error-thrown";
}

describe("4E3B3 V2 reroll orchestration", () => {
  describe("NORMAL REROLL", () => {
    it("normal accepted reroll: N -> N+1", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 3 }));
      seedV2(harness.bucket, makeVersionedDraft(3, 1));
      const result = await rerollDraftV2(harness.deps, IDENTITY, 3, "seed-123");

      expect(result).not.toBeNull();
      expect(result?.draft.version).toBe(4);
    });

    it("exact event order: claim -> put -> commit", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 5 }));
      seedV2(harness.bucket, makeVersionedDraft(5, 1));

      await rerollDraftV2(harness.deps, IDENTITY, 5, "seed-456");

      expect(harness.events).toEqual(["claim", "put", "commit"]);
    });

    it("returned draft is exactly N+1", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 2 }));
      seedV2(harness.bucket, makeVersionedDraft(2, 1));
      const result = await rerollDraftV2(harness.deps, IDENTITY, 2, "seed");

      expect(result?.draft.version).toBe(3);
      expect(result?.draft.baseVersion).toBe(1);
    });

    it("no N+2 write exists", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 7 }));
      seedV2(harness.bucket, makeVersionedDraft(7, 1));

      await rerollDraftV2(harness.deps, IDENTITY, 7, "seed");

      expect(harness.bucket.putKeys).not.toContain(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 9),
      );
    });

    it("persisted snapshot equals domain-produced snapshot", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 4 }));
      const current = makeVersionedDraft(4, 1);
      seedV2(harness.bucket, current);
      const domainResult = rerollLockedDraftValuesV2(current, "test-seed");

      const _result = await rerollDraftV2(
        harness.deps,
        IDENTITY,
        4,
        "test-seed",
      );

      const storedKey = getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 5);
      const stored = harness.bucket.objects.get(storedKey);
      expect(stored).toBeDefined();
      const storedDraft = JSON.parse(stored!) as CharacterSheetDraftV2;
      expect(storedDraft.version).toBe(5);
      // The persisted snapshot should equal the domain-produced one
      expect(storedDraft).toEqual(domainResult.draft);
    });

    it("rerolledKeys preserved exactly from domain", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 4 }));
      seedV2(harness.bucket, makeVersionedDraft(4, 1));
      const domainResult = rerollLockedDraftValuesV2(
        makeVersionedDraft(4, 1),
        "exact-seed",
      );

      const result = await rerollDraftV2(
        harness.deps,
        IDENTITY,
        4,
        "exact-seed",
      );

      expect(result?.rerolledKeys).toEqual(domainResult.rerolledKeys);
    });
  });

  describe("ZERO ELIGIBLE FIELDS", () => {
    it("ZERO eligible fields: rerolledKeys=[], version N+1, claim -> put -> commit", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 6 }));
      // Valid V2 draft with no eligible reroll fields (all unlocked text, no draw grammar)
      const noEligible = makeDraftV2({
        version: 6,
        baseVersion: 1,
        characterName: "Test",
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "A", label: "A", type: "text", locked: false },
          { key: "B", label: "B", type: "text", locked: false },
        ],
        structure: [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "A", parentKey: null },
          { kind: "field", key: "B", parentKey: null },
        ],
        values: { character_name: "Test", A: "A", B: "B" },
      });
      seedV2(harness.bucket, noEligible);

      const result = await rerollDraftV2(
        harness.deps,
        IDENTITY,
        6,
        "seed-zero",
      );

      expect(result?.draft.version).toBe(7);
      expect(result?.rerolledKeys).toEqual([]);
      expect(harness.events).toEqual(["claim", "put", "commit"]);
    });

    it("D1 advances exactly once even with zero eligible", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 6 }));
      // Valid V2 draft with no eligible reroll fields (all unlocked text, no draw grammar)
      const noEligible = makeDraftV2({
        version: 6,
        baseVersion: 1,
        characterName: "Test",
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "A", label: "A", type: "text", locked: false },
          { key: "B", label: "B", type: "text", locked: false },
        ],
        structure: [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "A", parentKey: null },
          { kind: "field", key: "B", parentKey: null },
        ],
        values: { character_name: "Test", A: "A", B: "B" },
      });
      seedV2(harness.bucket, noEligible);

      await rerollDraftV2(harness.deps, IDENTITY, 6, "seed");

      const head = await harness.heads.getHead(IDENTITY);
      expect(head?.currentVersion).toBe(7);
    });
  });

  describe("EXPECTED VERSION / PENDING", () => {
    it("stale expectedVersion -> version_conflict", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 7 }));
      seedV2(harness.bucket, makeVersionedDraft(7, 1));

      const code = await errorCodeOf(() =>
        rerollDraftV2(harness.deps, IDENTITY, 6, "seed"),
      );

      expect(code).toBe("version_conflict");
      expect(harness.events).toEqual([]);
    });

    it("matching expectedVersion + pending -> draft_inflight", async () => {
      const harness = makeHarness(
        makeHead({
          currentVersion: 7,
          pendingVersion: 8,
          pendingClaimId: "c1",
        }),
      );
      seedV2(harness.bucket, makeVersionedDraft(7, 1));

      const code = await errorCodeOf(() =>
        rerollDraftV2(harness.deps, IDENTITY, 7, "seed"),
      );

      expect(code).toBe("draft_inflight");
      expect(harness.events).toEqual([]);
    });

    it("pending + stale -> version_conflict wins", async () => {
      const harness = makeHarness(
        makeHead({
          currentVersion: 7,
          pendingVersion: 8,
          pendingClaimId: "c1",
        }),
      );
      seedV2(harness.bucket, makeVersionedDraft(7, 1));

      const code = await errorCodeOf(() =>
        rerollDraftV2(harness.deps, IDENTITY, 6, "seed"),
      );

      expect(code).toBe("version_conflict");
      expect(harness.events).toEqual([]);
    });
  });

  describe("MISSING RESOURCE", () => {
    it("missing head -> null, zero persistence", async () => {
      const harness = makeHarness(null);

      const result = await rerollDraftV2(harness.deps, IDENTITY, 1, "seed");

      expect(result).toBeNull();
      expect(harness.events).toEqual([]);
    });

    it("missing snapshot -> null, zero persistence", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 3 }));
      // Do NOT seed the snapshot

      const result = await rerollDraftV2(harness.deps, IDENTITY, 3, "seed");

      expect(result).toBeNull();
      expect(harness.events).toEqual([]);
    });
  });

  describe("HISTORICAL V1 -> V2 REROLL", () => {
    it("historical V1 canonicalized, V2 N+1 written, V1 bytes unchanged", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 3 }));
      const v1Draft = {
        schemaVersion: "1" as const,
        draftId: DRAFT_ID,
        sessionId: SESSION_ID,
        baseVersion: 1,
        version: 3,
        mode: "pc" as const,
        characterName: "Legacy",
        rulesContextId: null,
        fields: [
          {
            key: "character_name",
            label: "Character Name",
            type: "text",
            locked: false,
          },
          { key: "A", label: "A", type: "text", locked: true },
        ],
        sections: [],
        values: { character_name: "Legacy", A: 2 },
        source: { sourceSheetId: "sheet.0001", sourceRunId: null },
        confirmed: false,
      };
      harness.bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 3),
        JSON.stringify(v1Draft),
      );

      const result = await rerollDraftV2(
        harness.deps,
        IDENTITY,
        3,
        "hist-seed",
      );

      expect(result?.draft.version).toBe(4);
      expect(result?.draft.schemaVersion).toBe(
        CHARACTER_SHEET_DRAFT_V2_VERSION,
      );
      // Historical V1 bytes unchanged
      const originalKey = getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 3);
      expect(harness.bucket.objects.get(originalKey)).toBe(
        JSON.stringify(v1Draft),
      );
      // New V2 N+1 exists
      expect(
        harness.bucket.objects.has(
          getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 4),
        ),
      ).toBe(true);
      // D1 advanced
      const head = await harness.heads.getHead(IDENTITY);
      expect(head?.currentVersion).toBe(4);
    });

    it("historical V1 + zero eligible: STILL writes V2 N+1", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 2 }));
      const v1Draft = {
        schemaVersion: "1" as const,
        draftId: DRAFT_ID,
        sessionId: SESSION_ID,
        baseVersion: 1,
        version: 2,
        mode: "pc" as const,
        characterName: "Old",
        rulesContextId: null,
        fields: [
          {
            key: "character_name",
            label: "Character Name",
            type: "text",
            locked: false,
          },
          {
            key: "A",
            label: "A",
            type: "number",
            min: 1,
            max: 6,
            locked: true,
          },
        ],
        sections: [],
        values: { character_name: "Old" },
        source: { sourceSheetId: "sheet.0001", sourceRunId: null },
        confirmed: false,
      };
      harness.bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
        JSON.stringify(v1Draft),
      );

      const result = await rerollDraftV2(harness.deps, IDENTITY, 2, "seed");

      expect(result?.draft.version).toBe(3);
      expect(result?.draft.schemaVersion).toBe(
        CHARACTER_SHEET_DRAFT_V2_VERSION,
      );
      // New V2 N+1 written
      expect(
        harness.bucket.objects.has(
          getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 3),
        ),
      ).toBe(true);
      // D1 advanced
      const head = await harness.heads.getHead(IDENTITY);
      expect(head?.currentVersion).toBe(3);
    });
  });

  describe("ERROR PROPAGATION", () => {
    it("storage/persistence DraftError propagates unchanged", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 4 }));
      seedV2(harness.bucket, makeVersionedDraft(4, 1));
      const deps = {
        ...harness.deps,
        store: {
          ...harness.deps.store,
          putDraft: async () => {
            throw new DraftError("corrupt_draft", "sentinel message");
          },
        },
      };

      const error = await errorCodeOf(() =>
        rerollDraftV2(deps, IDENTITY, 4, "seed"),
      );

      expect(error).toBe("corrupt_draft");
    });

    it("domain confirmed error propagates", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 4 }));
      seedV2(
        harness.bucket,
        makeDraftV2({ confirmed: true, version: 4, baseVersion: 1 }),
      );

      const code = await errorCodeOf(() =>
        rerollDraftV2(harness.deps, IDENTITY, 4, "seed"),
      );

      expect(code).toBe("draft_confirmed");
      expect(harness.events).toEqual([]);
    });

    it("expectedVersion/inflight precedence for reroll", async () => {
      const pendingHarness = makeHarness(
        makeHead({
          currentVersion: 7,
          pendingVersion: 8,
          pendingClaimId: "c1",
        }),
      );
      seedV2(pendingHarness.bucket, makeVersionedDraft(7, 1));
      expect(
        await errorCodeOf(() =>
          rerollDraftV2(pendingHarness.deps, IDENTITY, 7, "seed"),
        ),
      ).toBe("draft_inflight");

      const staleHarness = makeHarness(makeHead({ currentVersion: 7 }));
      seedV2(staleHarness.bucket, makeVersionedDraft(7, 1));
      expect(
        await errorCodeOf(() =>
          rerollDraftV2(staleHarness.deps, IDENTITY, 6, "seed"),
        ),
      ).toBe("version_conflict");
    });
  });

  describe("REROLL vs MUTATION NO-OP DIFFERENCE", () => {
    it("REROLL accepted with zero eligible fields STILL persists N+1 (mutation would no-op)", async () => {
      const harness = makeHarness(makeHead({ currentVersion: 5 }));
      // Valid V2 draft with no eligible reroll fields (all text, no draw grammar)
      const noEligible = makeDraftV2({
        version: 5,
        baseVersion: 1,
        characterName: "Test",
        fields: [
          { key: "character_name", label: "Name", type: "text", locked: false },
          { key: "A", label: "A", type: "text", locked: true },
          { key: "B", label: "B", type: "text", locked: true },
          { key: "C", label: "C", type: "text", locked: true },
        ],
        structure: [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "A", parentKey: null },
          { kind: "field", key: "B", parentKey: null },
          { kind: "field", key: "C", parentKey: null },
        ],
        values: { character_name: "Test", A: "A", B: "B", C: "C" },
      });
      seedV2(harness.bucket, noEligible);

      const result = await rerollDraftV2(harness.deps, IDENTITY, 5, "seed");

      expect(result?.draft.version).toBe(6);
      expect(harness.events).toEqual(["claim", "put", "commit"]);
    });
  });
});
