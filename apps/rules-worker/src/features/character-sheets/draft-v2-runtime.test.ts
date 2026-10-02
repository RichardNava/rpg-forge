/**
 * 4E3B1 — focused tests for the V2 orchestration kernel.
 *
 * These exercise the REAL `createR2CharacterSheetDraftStoreV2` adapter over a
 * deterministic in-memory bucket, plus the existing `FakeDraftHeadRepository`,
 * so the V1/V2 canonicalization boundary, the payload/key corruption checks and
 * the claim/release/commit CAS outcomes are all covered as they actually behave
 * rather than as a fake store would like them to.
 *
 * Nothing here touches a route: the kernel is not wired to `AppDeps`.
 */
import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  DraftError,
  getDraftSnapshotKey,
  type CharacterSheetDraft,
  type CharacterSheetDraftV2,
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
import {
  assertDraftV2Precondition,
  openDraftV2Mutation,
  persistNextDraftV2,
  readCurrentDraftV2,
  type DraftV2Runtime,
} from "./draft-v2-runtime.js";

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT_ID = "d8f2b0c1-3a4e-4f6b-9c1d-2e3a4b5c6d7e";
const IDENTITY = { sessionId: SESSION_ID, draftId: DRAFT_ID };
const CLOCK_ISO = "2026-03-01T10:00:00.000Z";

/**
 * In-memory bucket that records every call. `putKeys` is the proof that a read
 * performs zero writes; `failNextPut`/`failNextGet` inject storage failures.
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
  /** Ordered log of "claim" / "put" / "commit" / "release" calls. */
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
      // A class instance spread loses its prototype methods, so the untouched
      // port methods are bound explicitly.
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

describe("4E3B1 V2 read: current canonical snapshot", () => {
  it("returns the stored current V2 snapshot as canonical V2", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 4 }));
    seedV2(harness.bucket, makeDraftV2({ version: 4, baseVersion: 4 }));

    const state = await readCurrentDraftV2(harness.deps, IDENTITY);

    expect(state?.head.currentVersion).toBe(4);
    expect(state?.draft?.version).toBe(4);
    expect(state?.draft?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
  });

  it("canonicalizes a historical V1 snapshot to V2 in memory", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 2 }));
    harness.bucket.seed(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
      JSON.stringify(makeDraftV1({ version: 2, baseVersion: 2 })),
    );

    const state = await readCurrentDraftV2(harness.deps, IDENTITY);

    expect(state?.draft?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
    expect(state?.draft?.version).toBe(2);
  });

  it("performs ZERO writes when reading a historical V1 snapshot", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 2 }));
    const key = getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2);
    const storedV1 = JSON.stringify(
      makeDraftV1({ version: 2, baseVersion: 2 }),
    );
    harness.bucket.seed(key, storedV1);

    await readCurrentDraftV2(harness.deps, IDENTITY);
    // A second read proves the first did not mutate stored bytes either.
    await readCurrentDraftV2(harness.deps, IDENTITY);

    expect(harness.bucket.putKeys).toEqual([]);
    expect(harness.bucket.objects.get(key)).toBe(storedV1);
  });

  it("reports a missing snapshot as absent, never as a storage failure", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 5 }));

    const state = await readCurrentDraftV2(harness.deps, IDENTITY);

    expect(state).not.toBeNull();
    expect(state?.head.currentVersion).toBe(5);
    expect(state?.draft).toBeNull();
  });

  it("reports a missing head as null", async () => {
    const harness = makeHarness(null);

    expect(await readCurrentDraftV2(harness.deps, IDENTITY)).toBeNull();
  });

  it("keeps payload/key identity mismatch as corruption from the store boundary", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 6 }));
    // Stored at the v6 key but the payload announces v5.
    harness.bucket.seed(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 6),
      JSON.stringify(makeDraftV2({ version: 5, baseVersion: 5 })),
    );

    const code = await errorCodeOf(() =>
      readCurrentDraftV2(harness.deps, IDENTITY),
    );

    expect(code).toBe("corrupt_draft");
  });

  it("reads the snapshot at head.currentVersion, never at pendingVersion", async () => {
    const harness = makeHarness(
      makeHead({ currentVersion: 7, pendingVersion: 8, pendingClaimId: "c1" }),
    );
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));

    const state = await readCurrentDraftV2(harness.deps, IDENTITY);

    expect(harness.bucket.getKeys).toEqual([
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 7),
    ]);
    expect(state?.draft?.version).toBe(7);
  });
});

describe("4E3B1 first barrier: expectedVersion", () => {
  it("rejects a stale expectedVersion", () => {
    const head = makeHead({ currentVersion: 7 });

    expect(() => assertDraftV2Precondition(head, 6)).toThrowError(DraftError);
    expect(errorCodeOfSync(() => assertDraftV2Precondition(head, 6))).toBe(
      "version_conflict",
    );
  });

  it("frozen row 1: current=7 pending=8 expected=6 -> version_conflict", () => {
    const head = makeHead({
      currentVersion: 7,
      pendingVersion: 8,
      pendingClaimId: "c1",
    });

    expect(errorCodeOfSync(() => assertDraftV2Precondition(head, 6))).toBe(
      "version_conflict",
    );
  });

  it("frozen row 2: current=7 pending=8 expected=7 -> draft_inflight", () => {
    const head = makeHead({
      currentVersion: 7,
      pendingVersion: 8,
      pendingClaimId: "c1",
    });

    expect(errorCodeOfSync(() => assertDraftV2Precondition(head, 7))).toBe(
      "draft_inflight",
    );
  });

  it("frozen row 3: current=7 pending=8 expected=8 -> version_conflict", () => {
    const head = makeHead({
      currentVersion: 7,
      pendingVersion: 8,
      pendingClaimId: "c1",
    });

    expect(errorCodeOfSync(() => assertDraftV2Precondition(head, 8))).toBe(
      "version_conflict",
    );
  });

  it("gives stale precedence over inflight for every stale value", () => {
    const head = makeHead({
      currentVersion: 7,
      pendingVersion: 8,
      pendingClaimId: "c1",
    });

    for (const stale of [0, 5, 6, 8, 9, 100]) {
      expect(
        errorCodeOfSync(() => assertDraftV2Precondition(head, stale)),
      ).toBe("version_conflict");
    }
  });

  it("accepts a matching expectedVersion on a stable head", () => {
    expect(() =>
      assertDraftV2Precondition(makeHead({ currentVersion: 7 }), 7),
    ).not.toThrow();
  });

  it("runs the barrier before any R2 read", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));

    const code = await errorCodeOf(() =>
      openDraftV2Mutation(harness.deps, IDENTITY, 6),
    );

    expect(code).toBe("version_conflict");
    expect(harness.bucket.getKeys).toEqual([]);
  });

  it("reports inflight before reading when expectedVersion matches", async () => {
    const harness = makeHarness(
      makeHead({ currentVersion: 7, pendingVersion: 8, pendingClaimId: "c1" }),
    );
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));

    const code = await errorCodeOf(() =>
      openDraftV2Mutation(harness.deps, IDENTITY, 7),
    );

    expect(code).toBe("draft_inflight");
    expect(harness.bucket.getKeys).toEqual([]);
  });

  it("returns current state when the barrier passes", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));

    const state = await openDraftV2Mutation(harness.deps, IDENTITY, 7);

    expect(state?.draft?.version).toBe(7);
  });

  it("never infers expectedVersion from D1", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));

    // expectedVersion 6 and 8 are both rejected: only the client's own value,
    // compared verbatim against currentVersion, can open the mutation.
    expect(
      await errorCodeOf(() => openDraftV2Mutation(harness.deps, IDENTITY, 6)),
    ).toBe("version_conflict");
    expect(
      await errorCodeOf(() => openDraftV2Mutation(harness.deps, IDENTITY, 8)),
    ).toBe("version_conflict");
    expect(
      (await openDraftV2Mutation(harness.deps, IDENTITY, 7))?.draft?.version,
    ).toBe(7);
  });
});

describe("4E3B1 second barrier: persist an already-produced N+1", () => {
  const current = makeDraftV2({ version: 7, baseVersion: 7 });

  it("runs claim -> R2 put -> commit in that order", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    await persistNextDraftV2(harness.deps, current, next);

    expect(harness.events).toEqual(["claim", "put", "commit"]);
  });

  it("writes exactly the domain-produced N+1 with no extra bump", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    const committed = await persistNextDraftV2(harness.deps, current, next);

    expect(committed.version).toBe(8);
    expect(harness.bucket.putKeys).toEqual([
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 8),
    ]);
    const stored = harness.bucket.objects.get(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 8),
    );
    expect(JSON.parse(stored ?? "{}").version).toBe(8);
  });

  it("advances D1 currentVersion exactly once", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    await persistNextDraftV2(harness.deps, current, next);

    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(8);
    expect(head?.pendingVersion).toBeNull();
    expect(head?.pendingClaimId).toBeNull();
  });

  it("never writes N+2", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    seedV2(harness.bucket, current);
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    await persistNextDraftV2(harness.deps, current, next);

    expect(harness.bucket.putKeys).not.toContain(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 9),
    );
    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(8);
  });

  it("performs zero R2 writes when the claim reports a live claim", async () => {
    const harness = makeHarness(
      makeHead({ currentVersion: 7, pendingVersion: 8, pendingClaimId: "c1" }),
    );
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, next),
    );

    expect(code).toBe("draft_inflight");
    expect(harness.bucket.putKeys).toEqual([]);
    expect(harness.events).toEqual(["claim"]);
  });

  it("performs zero R2 writes when the claim conflicts on version", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 9 }));
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, next),
    );

    expect(code).toBe("version_conflict");
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("treats a vanished head as a version conflict without writing", async () => {
    const harness = makeHarness(null);

    const code = await errorCodeOf(() =>
      persistNextDraftV2(
        harness.deps,
        current,
        makeDraftV2({ version: 8, baseVersion: 7 }),
      ),
    );

    expect(code).toBe("version_conflict");
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("releases the claim and preserves the store error when the R2 write fails", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    harness.bucket.failNextPut = true;
    const next = makeDraftV2({ version: 8, baseVersion: 7 });

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, next),
    );

    expect(code).toBe("storage_unavailable");
    expect(harness.events).toEqual(["claim", "put", "release"]);
    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(7);
    expect(head?.pendingVersion).toBeNull();
  });

  it("leaves no visible skipped version after a failed write", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    harness.bucket.failNextPut = true;
    seedV2(harness.bucket, current);

    await errorCodeOf(() =>
      persistNextDraftV2(
        harness.deps,
        current,
        makeDraftV2({ version: 8, baseVersion: 7 }),
      ),
    );

    const head = await harness.heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(7);
    expect(
      harness.bucket.objects.has(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 8)),
    ).toBe(false);
  });

  it("releases the claim and conflicts when the commit does not match", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const heads = harness.heads;
    const deps: DraftV2Runtime = {
      ...harness.deps,
      heads: {
        ...harness.deps.heads,
        commit: async (identity, claimId, expected, committedAt) => {
          harness.events.push("commit");
          // Simulate another writer having superseded our claim.
          await heads.release(identity, claimId, expected + 1, committedAt);
          return heads.commit(identity, claimId, expected, committedAt);
        },
      },
    };

    const code = await errorCodeOf(() =>
      persistNextDraftV2(
        deps,
        current,
        makeDraftV2({ version: 8, baseVersion: 7 }),
      ),
    );

    expect(code).toBe("version_conflict");
    expect(harness.events).toEqual(["claim", "put", "commit", "release"]);
    const head = await heads.getHead(IDENTITY);
    expect(head?.currentVersion).toBe(7);
  });

  it("rethrows a storage failure unchanged rather than masking it", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const next = makeDraftV2({ version: 8, baseVersion: 7 });
    const deps: DraftV2Runtime = {
      ...harness.deps,
      store: {
        ...harness.deps.store,
        putDraft: async () => {
          throw new DraftError("corrupt_draft", "sentinel message");
        },
      },
    };

    const error = await captureError(() =>
      persistNextDraftV2(deps, current, next),
    );

    expect(error?.code).toBe("corrupt_draft");
    expect(error?.message).toBe("sentinel message");
  });

  it("refuses a next snapshot that is not current + 1", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));

    const skipped = await errorCodeOf(() =>
      persistNextDraftV2(
        harness.deps,
        current,
        makeDraftV2({ version: 9, baseVersion: 7 }),
      ),
    );
    const repeated = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, current),
    );

    expect(skipped).toBe("invalid_draft");
    expect(repeated).toBe("invalid_draft");
    // Rejected BEFORE the claim, so nothing was claimed or written.
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("refuses a next snapshot belonging to a different draft", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, {
        ...makeDraftV2({ version: 8, baseVersion: 7 }),
        draftId: "other-draft",
      }),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
  });

  it("refuses a next snapshot with a changed sessionId", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, {
        ...makeDraftV2({ version: 8, baseVersion: 7 }),
        sessionId: "other-session",
      }),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
  });

  it("refuses a next snapshot with a changed baseVersion", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));

    const code = await errorCodeOf(() =>
      persistNextDraftV2(harness.deps, current, {
        ...makeDraftV2({ version: 8, baseVersion: 99 }),
      }),
    );

    expect(code).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
  });
});

describe("4E3B1 semantic no-op compatibility", () => {
  it("lets a caller return current N without invoking persistence", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    seedV2(harness.bucket, makeDraftV2({ version: 7, baseVersion: 7 }));
    const state = await openDraftV2Mutation(harness.deps, IDENTITY, 7);
    const current = state?.draft;
    expect(current).not.toBeNull();
    if (current === null || current === undefined) {
      throw new Error("unreachable: barrier admitted a missing snapshot");
    }

    // Stand-in for the 4E3B2 domain call: a no-op returns the SAME reference.
    const next = current;
    const result =
      next.version === current.version
        ? current
        : await persistNextDraftV2(harness.deps, current, next);

    expect(result).toBe(current);
    expect(harness.events).toEqual([]);
    expect(harness.bucket.putKeys).toEqual([]);
    expect((await harness.heads.getHead(IDENTITY))?.currentVersion).toBe(7);
  });

  it("never treats N -> N as a write inside persistence", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 7 }));
    const current = makeDraftV2({ version: 7, baseVersion: 7 });

    // The kernel must reject the no-op rather than claiming a version for it.
    expect(
      await errorCodeOf(() =>
        persistNextDraftV2(harness.deps, current, current),
      ),
    ).toBe("invalid_draft");
    expect(harness.events).toEqual([]);
  });
});

describe("4E3B1 error channel", () => {
  it("keeps a storage read failure as a DraftError", async () => {
    const harness = makeHarness(makeHead({ currentVersion: 3 }));
    seedV2(harness.bucket, makeDraftV2({ version: 3, baseVersion: 3 }));
    harness.bucket.failNextGet = true;

    const error = await captureError(() =>
      readCurrentDraftV2(harness.deps, IDENTITY),
    );

    expect(error).toBeInstanceOf(DraftError);
    expect(error?.code).toBe("storage_unavailable");
  });

  it("keeps every concurrency failure as a DraftError", async () => {
    const inflight = makeHarness(
      makeHead({ currentVersion: 7, pendingVersion: 8, pendingClaimId: "c1" }),
    );
    expect(
      await captureError(() => openDraftV2Mutation(inflight.deps, IDENTITY, 7)),
    ).toBeInstanceOf(DraftError);

    const stale = makeHarness(makeHead({ currentVersion: 7 }));
    expect(
      await captureError(() => openDraftV2Mutation(stale.deps, IDENTITY, 6)),
    ).toBeInstanceOf(DraftError);
  });

  it("exposes no artificial result-union error channel", async () => {
    const module = await import("./draft-v2-runtime.js");
    const exported = Object.keys(module).sort();

    expect(exported).toEqual([
      "assertDraftV2Precondition",
      "openDraftV2Mutation",
      "persistNextDraftV2",
      "readCurrentDraftV2",
    ]);
    for (const removed of [
      "DraftV2Outcome",
      "runDraftV2Operation",
      "draftErrorV2Response",
    ]) {
      expect(exported).not.toContain(removed);
    }
  });

  it("throws rather than returning an error result for every failure path", async () => {
    const barrierHarness = makeHarness(makeHead({ currentVersion: 7 }));
    // The head has moved to 9, so persisting a next of 8 must fail at the claim.
    const persistHarness = makeHarness(makeHead({ currentVersion: 9 }));

    const barrier = await captureError(() =>
      openDraftV2Mutation(barrierHarness.deps, IDENTITY, 1),
    );
    const persist = await captureError(() =>
      persistNextDraftV2(
        persistHarness.deps,
        makeDraftV2({ version: 7, baseVersion: 7 }),
        makeDraftV2({ version: 8, baseVersion: 7 }),
      ),
    );

    expect(barrier).toBeInstanceOf(DraftError);
    expect(barrier?.code).toBe("version_conflict");
    expect(persist).toBeInstanceOf(DraftError);
    expect(persist?.code).toBe("version_conflict");
  });
});

function errorCodeOfSync(action: () => void): string {
  try {
    action();
  } catch (error) {
    return error instanceof DraftError
      ? error.code
      : `non-draft-error:${String(error)}`;
  }
  return "no-error-thrown";
}

async function captureError(
  action: () => Promise<unknown>,
): Promise<DraftError | null> {
  try {
    await action();
  } catch (error) {
    return error instanceof DraftError
      ? error
      : new DraftError("invalid_draft", String(error));
  }
  return null;
}
