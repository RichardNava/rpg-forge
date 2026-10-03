/**
 * 4E3B4B2 — focused tests for the V2 create orchestration.
 *
 * These exercise the REAL `createR2CharacterSheetDraftStoreV2` adapter over a
 * deterministic in-memory bucket, plus the existing `FakeDraftHeadRepository`,
 * so atomic create-if-absent, orphan recovery, and D1 head creation are covered
 * as they actually behave rather than as a fake store would like them to.
 *
 * Nothing here touches a route: the kernel is not wired to `AppDeps`.
 */
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  DraftError,
  getDraftSnapshotKey,
  type CharacterSheetDraft,
  type CharacterSheetDraftStoreV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type {
  DraftHead,
  DraftHeadRepositoryPort,
} from "@repo/character-sheet-session";
import { describe, expect, it } from "vitest";
import type { R2BucketLike } from "../../infrastructure/r2-character-sheet-artifacts.js";
import { createR2CharacterSheetDraftStoreV2 } from "../../infrastructure/r2-character-sheet-drafts-v2.js";
import { FakeDraftHeadRepository } from "../../test/fakes.js";
import { createDraftV2, type DraftV2CreateDeps } from "./draft-v2-create.js";

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT_ID = "d8f2b0c1-3a4e-4f6b-9c1d-2e3a4b5c6d7e";
const IDENTITY = { sessionId: SESSION_ID, draftId: DRAFT_ID };

/**
 * In-memory bucket that models atomic conditional create. `putKeys` records
 * every PUT attempt (a conditional miss still invokes `bucket.put`);
 * `putOnlyIf` records the `onlyIf` condition so tests pin `If-None-Match: *`.
 */
class RecordingBucket implements R2BucketLike {
  readonly objects = new Map<string, string>();
  readonly putKeys: string[] = [];
  readonly putOnlyIf: Array<Headers | undefined> = [];
  failNextPut = false;

  seed(key: string, payload: string): void {
    this.objects.set(key, payload);
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options?: {
      onlyIf?: Headers;
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<unknown> {
    this.putKeys.push(key);
    this.putOnlyIf.push(options?.onlyIf);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("r2 put unavailable");
    }
    if (options?.onlyIf?.get("If-None-Match") === "*") {
      if (this.objects.has(key)) {
        return null;
      }
    }
    this.objects.set(
      key,
      typeof value === "string" ? value : new TextDecoder().decode(value),
    );
    return {};
  }

  async get(key: string): Promise<{
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
  } | null> {
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

/** Canonical V2 draft; root Fields only so `sections` stays empty. */
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
    ],
    sections: [],
    structure: [{ kind: "field", key: "character_name", parentKey: null }],
    values: { character_name: "Aria Stone" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
    ...overrides,
  };
}

/** Two-value draft for key-order/array-order equality checks. */
function makeTwoFieldDraft(
  order:
    "name-first" | "nickname-first" | "nickname-structure-first" = "name-first",
): CharacterSheetDraftV2 {
  const fields =
    order === "nickname-structure-first"
      ? [
          { key: "nickname", label: "Nickname", type: "text", locked: false },
          {
            key: "character_name",
            label: "Character Name",
            type: "text",
            locked: false,
          },
        ]
      : [
          {
            key: "character_name",
            label: "Character Name",
            type: "text",
            locked: false,
          },
          { key: "nickname", label: "Nickname", type: "text", locked: false },
        ];
  const structure =
    order === "nickname-structure-first"
      ? [
          { kind: "field", key: "nickname", parentKey: null },
          { kind: "field", key: "character_name", parentKey: null },
        ]
      : [
          { kind: "field", key: "character_name", parentKey: null },
          { kind: "field", key: "nickname", parentKey: null },
        ];
  const values: Record<string, string> =
    order === "nickname-first"
      ? (() => {
          const record: Record<string, string> = {};
          record.nickname = "Ash";
          record.character_name = "Aria Stone";
          return record;
        })()
      : { character_name: "Aria Stone", nickname: "Ash" };
  return {
    schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
    draftId: DRAFT_ID,
    sessionId: SESSION_ID,
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields,
    sections: [],
    structure,
    values,
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  } as CharacterSheetDraftV2;
}

/** Historical V1 draft, as persisted before the canonical V2 boundary existed. */
function makeDraftV1(
  overrides: Partial<CharacterSheetDraft> = {},
): CharacterSheetDraft {
  const {
    sections: _sections,
    structure: _structure,
    ...rest
  } = {
    ...makeDraftV2(),
    ...overrides,
    schemaVersion: "1" as unknown as typeof CHARACTER_SHEET_DRAFT_V2_VERSION,
  };
  return rest as unknown as CharacterSheetDraft;
}

interface Harness {
  deps: DraftV2CreateDeps;
  bucket: RecordingBucket;
  heads: FakeDraftHeadRepository;
  events: string[];
}

function makeHarness(): Harness {
  const bucket = new RecordingBucket();
  const store = createR2CharacterSheetDraftStoreV2(bucket);
  const heads = new FakeDraftHeadRepository();
  const events: string[] = [];
  const deps: DraftV2CreateDeps = {
    heads: {
      create: async (identity) => {
        events.push("create-head");
        return heads.create(identity);
      },
      getHead: async (identity) => {
        events.push("get-head");
        return heads.getHead(identity);
      },
      getStable: (identity) => heads.getStable(identity),
      claim: (identity, expectedVersion, claimId, claimsAt) =>
        heads.claim(identity, expectedVersion, claimId, claimsAt),
      commit: (identity, claimId, expected, committedAt) =>
        heads.commit(identity, claimId, expected, committedAt),
      release: (identity, claimId, version, releasedAt) =>
        heads.release(identity, claimId, version, releasedAt),
      findStalePending: (now, staleAfterMs, limit) =>
        heads.findStalePending(now, staleAfterMs, limit),
      deleteSessionHeads: (sessionId) => heads.deleteSessionHeads(sessionId),
    },
    store: {
      putInitialDraftIfAbsent: async (draft) => {
        events.push("put-initial");
        return store.putInitialDraftIfAbsent(draft);
      },
      putDraft: (draft) => store.putDraft(draft),
      getDraftVersion: async (identity, version) => {
        events.push("get-draft");
        return store.getDraftVersion(identity, version);
      },
      getLatestDraft: (identity) => store.getLatestDraft(identity),
      listDraftVersions: (identity) => store.listDraftVersions(identity),
      deleteDraft: (identity) => store.deleteDraft(identity),
    },
  };
  return { deps, bucket, heads, events };
}

function stubHeads(
  base: FakeDraftHeadRepository,
  overrides: Partial<DraftHeadRepositoryPort>,
): DraftHeadRepositoryPort {
  return {
    create: overrides.create ?? ((identity) => base.create(identity)),
    getHead: overrides.getHead ?? ((identity) => base.getHead(identity)),
    getStable: overrides.getStable ?? ((identity) => base.getStable(identity)),
    claim:
      overrides.claim ??
      ((identity, expectedVersion, claimId, claimsAt) =>
        base.claim(identity, expectedVersion, claimId, claimsAt)),
    commit:
      overrides.commit ??
      ((identity, claimId, expected, committedAt) =>
        base.commit(identity, claimId, expected, committedAt)),
    release:
      overrides.release ??
      ((identity, claimId, version, releasedAt) =>
        base.release(identity, claimId, version, releasedAt)),
    findStalePending:
      overrides.findStalePending ??
      ((now, staleAfterMs, limit) =>
        base.findStalePending(now, staleAfterMs, limit)),
    deleteSessionHeads:
      overrides.deleteSessionHeads ??
      ((sessionId) => base.deleteSessionHeads(sessionId)),
  };
}

function stubStore(
  base: CharacterSheetDraftStoreV2,
  overrides: Partial<CharacterSheetDraftStoreV2>,
): CharacterSheetDraftStoreV2 {
  return {
    putInitialDraftIfAbsent:
      overrides.putInitialDraftIfAbsent ??
      ((draft) => base.putInitialDraftIfAbsent(draft)),
    putDraft: overrides.putDraft ?? ((draft) => base.putDraft(draft)),
    getDraftVersion:
      overrides.getDraftVersion ??
      ((identity, version) => base.getDraftVersion(identity, version)),
    getLatestDraft:
      overrides.getLatestDraft ?? ((identity) => base.getLatestDraft(identity)),
    listDraftVersions:
      overrides.listDraftVersions ??
      ((identity) => base.listDraftVersions(identity)),
    deleteDraft:
      overrides.deleteDraft ?? ((identity) => base.deleteDraft(identity)),
  };
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

describe("4E3B4B2 V2 create orchestration", () => {
  it("C1 valid canonical V2 creates head version 1 with no pending claim", async () => {
    const harness = makeHarness();

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("unreachable");
    expect(result.draft.version).toBe(1);
    expect(result.draft.baseVersion).toBe(1);
    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(1);
    expect(head?.pendingVersion).toBeNull();
    expect(head?.pendingClaimId).toBeNull();
  });

  it("C2 session mismatch throws invalid_draft before any persistence", async () => {
    const harness = makeHarness();

    const code = await errorCodeOf(() =>
      createDraftV2(harness.deps, "other-session", makeDraftV2()),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
  });

  it("C3 version 2 throws invalid_draft with zero persistence", async () => {
    const harness = makeHarness();

    const code = await errorCodeOf(() =>
      createDraftV2(
        harness.deps,
        SESSION_ID,
        makeDraftV2({ version: 2, baseVersion: 1 }),
      ),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("C4 baseVersion 2 throws invalid_draft with zero persistence", async () => {
    const harness = makeHarness();

    const code = await errorCodeOf(() =>
      createDraftV2(
        harness.deps,
        SESSION_ID,
        makeDraftV2({ version: 1, baseVersion: 2 }),
      ),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("C5 confirmed true is allowed and preserved", async () => {
    const harness = makeHarness();

    const result = await createDraftV2(
      harness.deps,
      SESSION_ID,
      makeDraftV2({ confirmed: true }),
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("unreachable");
    expect(result.draft.confirmed).toBe(true);
  });

  it("C6 existing D1 head returns already_exists without touching R2", async () => {
    const harness = makeHarness();
    await harness.heads.create(IDENTITY);

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result).toEqual({ kind: "already_exists" });
    expect(harness.bucket.putKeys).toEqual([]);
    expect(harness.events).toEqual(["get-head"]);
  });

  it("C7 fresh R2 uses conditional create then D1 create", async () => {
    const harness = makeHarness();

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result.kind).toBe("created");
    expect(harness.events).toEqual(["get-head", "put-initial", "create-head"]);
    expect(harness.bucket.putOnlyIf).toHaveLength(1);
    expect(harness.bucket.putOnlyIf[0]?.get("If-None-Match")).toBe("*");
  });

  it("C8 equal R2 orphan with no head recovers by creating the head", async () => {
    const harness = makeHarness();
    const draft = makeDraftV2();
    harness.bucket.seed(
      getDraftSnapshotKey(draft.sessionId, draft.draftId, draft.version),
      JSON.stringify(draft),
    );
    const originalBytes = harness.bucket.objects.get(
      getDraftSnapshotKey(draft.sessionId, draft.draftId, draft.version),
    );

    const result = await createDraftV2(harness.deps, SESSION_ID, draft);

    expect(result.kind).toBe("created");
    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(1);
    expect(
      harness.bucket.objects.get(
        getDraftSnapshotKey(draft.sessionId, draft.draftId, draft.version),
      ),
    ).toBe(originalBytes);
  });

  it("C9 different R2 orphan returns already_exists without creating a head", async () => {
    const harness = makeHarness();
    const stored = makeDraftV2({
      characterName: "Stored",
      values: { character_name: "Stored" },
    });
    harness.bucket.seed(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      JSON.stringify(stored),
    );
    const originalBytes = harness.bucket.objects.get(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
    );

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result).toEqual({ kind: "already_exists" });
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
    expect(
      harness.bucket.objects.get(
        getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      ),
    ).toBe(originalBytes);
  });

  it("C10 R2 reports existing but the snapshot read is missing", async () => {
    const harness = makeHarness();
    const realStore = createR2CharacterSheetDraftStoreV2(harness.bucket);
    const deps: DraftV2CreateDeps = {
      heads: harness.deps.heads,
      store: stubStore(realStore, {
        putInitialDraftIfAbsent: async () => ({ kind: "already_exists" }),
        getDraftVersion: async () => null,
      }),
    };

    const code = await errorCodeOf(() =>
      createDraftV2(deps, SESSION_ID, makeDraftV2()),
    );

    expect(code).toBe("storage_unavailable");
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
  });

  it("C11 D1 loses the race after R2 create without deleting R2", async () => {
    const harness = makeHarness();
    const baseHeads = new FakeDraftHeadRepository();
    const losingHeads = stubHeads(baseHeads, {
      getHead: async () => null,
      create: async (identity) => ({
        kind: "already_exists",
        head: {
          sessionId: identity.sessionId,
          draftId: identity.draftId,
          currentVersion: 1,
          pendingVersion: null,
          pendingClaimId: null,
          pendingSince: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        } as DraftHead,
      }),
    });
    const deps: DraftV2CreateDeps = {
      heads: losingHeads,
      store: harness.deps.store,
    };

    const result = await createDraftV2(deps, SESSION_ID, makeDraftV2());

    expect(result).toEqual({ kind: "already_exists" });
    expect(
      harness.bucket.objects.has(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1)),
    ).toBe(true);
  });

  it("C12 crashed D1 create leaves an orphan that an equal retry recovers", async () => {
    const harness = makeHarness();
    const draft = makeDraftV2();
    let creations = 0;
    const crashingHeads = stubHeads(harness.heads, {
      create: async (identity) => {
        creations += 1;
        if (creations === 1) {
          throw new Error("d1 create crashed");
        }
        return harness.heads.create(identity);
      },
    });

    await expect(
      createDraftV2(
        { heads: crashingHeads, store: harness.deps.store },
        SESSION_ID,
        draft,
      ),
    ).rejects.toThrow("d1 create crashed");
    const orphanBytes = harness.bucket.objects.get(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
    );
    expect(orphanBytes).toBeDefined();

    const result = await createDraftV2(harness.deps, SESSION_ID, draft);

    expect(result.kind).toBe("created");
    expect(
      harness.bucket.objects.get(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1)),
    ).toBe(orphanBytes);
  });

  it("C13 historical V1 equal orphan recovers without rewriting V1 bytes", async () => {
    const harness = makeHarness();
    const storedV1 = JSON.stringify(makeDraftV1());
    harness.bucket.seed(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1), storedV1);

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result.kind).toBe("created");
    expect(await harness.heads.getHead(IDENTITY)).not.toBeNull();
    expect(
      harness.bucket.objects.get(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1)),
    ).toBe(storedV1);
  });

  it("C14 historical V1 different orphan returns already_exists without a head", async () => {
    const harness = makeHarness();
    const storedV1 = JSON.stringify(
      makeDraftV1({
        characterName: "Legacy Other",
        values: { character_name: "Legacy Other" },
      }),
    );
    harness.bucket.seed(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1), storedV1);

    const result = await createDraftV2(harness.deps, SESSION_ID, makeDraftV2());

    expect(result).toEqual({ kind: "already_exists" });
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
    expect(
      harness.bucket.objects.get(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1)),
    ).toBe(storedV1);
  });

  it("C15 equality ignores values key insertion order", async () => {
    const harness = makeHarness();
    const stored = makeTwoFieldDraft("nickname-first");
    harness.bucket.seed(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      JSON.stringify(stored),
    );
    const originalBytes = harness.bucket.objects.get(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
    );

    const result = await createDraftV2(
      harness.deps,
      SESSION_ID,
      makeTwoFieldDraft("name-first"),
    );

    expect(result.kind).toBe("created");
    expect(await harness.heads.getHead(IDENTITY)).not.toBeNull();
    expect(
      harness.bucket.objects.get(
        getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      ),
    ).toBe(originalBytes);
  });

  it("C16 equality treats canonical array order as significant", async () => {
    const harness = makeHarness();
    const stored = makeTwoFieldDraft("name-first");
    harness.bucket.seed(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      JSON.stringify(stored),
    );
    const originalBytes = harness.bucket.objects.get(
      getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
    );

    const result = await createDraftV2(
      harness.deps,
      SESSION_ID,
      makeTwoFieldDraft("nickname-structure-first"),
    );

    expect(result).toEqual({ kind: "already_exists" });
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
    expect(
      harness.bucket.objects.get(
        getDraftSnapshotKey(stored.sessionId, stored.draftId, stored.version),
      ),
    ).toBe(originalBytes);
  });

  it("R2 put failure surfaces storage_unavailable with no head", async () => {
    const harness = makeHarness();
    harness.bucket.failNextPut = true;

    const code = await errorCodeOf(() =>
      createDraftV2(harness.deps, SESSION_ID, makeDraftV2()),
    );

    expect(code).toBe("storage_unavailable");
    expect(await harness.heads.getHead(IDENTITY)).toBeNull();
  });
});
