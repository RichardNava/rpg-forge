import {
  CHARACTER_SHEET_DRAFT_V2_VERSION,
  DraftError,
  getDraftPrefix,
  getDraftSnapshotKey,
  type CharacterSheetDraft,
  type CharacterSheetDraftIdentity,
  type CharacterSheetDraftStoreV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";
import { createR2CharacterSheetDraftStore } from "./r2-character-sheet-drafts.js";
import { createR2CharacterSheetDraftStoreV2 } from "./r2-character-sheet-drafts-v2.js";

type StoredValue = {
  bytes: Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
};

/**
 * Deterministic in-memory bucket. `list` honors a small fixed page size so
 * pagination is exercised without 1000+ objects, and every call is counted so a
 * read can be proven to perform zero writes.
 */
class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, StoredValue>();
  readonly putKeys: string[] = [];
  readonly getKeys: string[] = [];
  readonly listPrefixes: string[] = [];
  private readonly pageSize = 2;
  private failPutOnCall: number | undefined;
  private failGetOnCall: number | undefined;
  private failNextText = false;
  private failNextList = false;
  private failNextDelete = false;

  failPutCall(call: number): void {
    this.failPutOnCall = call;
  }

  failGetCall(call: number): void {
    this.failGetOnCall = call;
  }

  /** Makes the next `object.text()` reject, simulating a body-read failure. */
  failText(): void {
    this.failNextText = true;
  }

  failList(): void {
    this.failNextList = true;
  }

  failDelete(): void {
    this.failNextDelete = true;
  }

  /** Raw seed: writes stored bytes with no validation, for corruption setup. */
  async seed(key: string, payload: string): Promise<void> {
    this.objects.set(key, {
      bytes: new TextEncoder().encode(payload),
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    });
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<void> {
    this.putKeys.push(key);
    if (this.putKeys.length === this.failPutOnCall) {
      this.failPutOnCall = undefined;
      throw new Error("r2 put unavailable");
    }
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType,
      cacheControl: options?.httpMetadata?.cacheControl,
    });
  }

  async get(
    key: string,
  ): Promise<{ text(): Promise<string>; bytes(): Promise<Uint8Array> } | null> {
    this.getKeys.push(key);
    if (this.getKeys.length === this.failGetOnCall) {
      this.failGetOnCall = undefined;
      throw new Error("r2 get unavailable");
    }
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return {
      text: async () => {
        if (this.failNextText) {
          this.failNextText = false;
          throw new Error("r2 body read unavailable");
        }
        return new TextDecoder().decode(stored.bytes);
      },
      bytes: async () => stored.bytes,
    };
  }

  async list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }> {
    this.listPrefixes.push(options?.prefix ?? "");
    if (this.failNextList) {
      this.failNextList = false;
      throw new Error("r2 list unavailable");
    }
    const prefix = options?.prefix ?? "";
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const startAfter = options?.cursor;
    const remaining =
      startAfter === undefined ? keys : keys.filter((key) => key > startAfter);
    const page = remaining.slice(0, this.pageSize);
    const truncated = remaining.length > this.pageSize;
    const lastKey = page.length > 0 ? page[page.length - 1] : undefined;
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      ...(truncated && lastKey !== undefined ? { cursor: lastKey } : {}),
    };
  }

  async delete(key: string | string[]): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("r2 delete unavailable");
    }
    for (const single of Array.isArray(key) ? key : [key]) {
      this.objects.delete(single);
    }
  }
}

const SESSION_ID = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
const DRAFT_ID = "d8f2b0c1-3a4e-4f6b-9c1d-2e3a4b5c6d7e";

function identityFor(
  overrides: Partial<CharacterSheetDraftIdentity> = {},
): CharacterSheetDraftIdentity {
  return { sessionId: SESSION_ID, draftId: DRAFT_ID, ...overrides };
}

/** Canonical V2 draft: root Fields only, so `sections` is empty. */
function makeValidDraftV2(
  overrides: Partial<CharacterSheetDraftV2> = {},
): CharacterSheetDraftV2 {
  const base: CharacterSheetDraftV2 = {
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
  };
  return { ...base, ...overrides };
}

/** Historical V1 draft, as persisted before the V2 canonical boundary existed. */
function makeValidDraftV1(
  overrides: Partial<CharacterSheetDraft> = {},
): CharacterSheetDraft {
  const base: CharacterSheetDraft = {
    schemaVersion: "1",
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
    values: { character_name: "Aria Stone" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
  return { ...base, ...overrides };
}

function remainingUnder(bucket: FakeR2Bucket, prefix: string): string[] {
  return [...bucket.objects.keys()].filter((key) => key.startsWith(prefix));
}

/**
 * Asserts the action throws a `DraftError` with the exact code.
 *
 * The action is invoked EXACTLY ONCE: the fake bucket consumes one-shot failure
 * flags on the failing call, so a second invocation would resolve normally and
 * mask the error under test.
 */
async function expectDraftErrorCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let captured: unknown;
  let threw = false;
  try {
    await action();
  } catch (error) {
    threw = true;
    captured = error;
  }
  expect(threw).toBe(true);
  expect(captured).toBeInstanceOf(DraftError);
  expect((captured as DraftError).code).toBe(code);
}

describe("4E1 R2 V2 character sheet draft store", () => {
  describe("WRITE — canonical V2 only", () => {
    it("1. round-trips a canonical V2 draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      const draft = makeValidDraftV2({ version: 3 });

      await store.putDraft(draft);

      expect(await store.getDraftVersion(identityFor(), 3)).toEqual(draft);
    });

    it("2. stores one immutable snapshot under the unchanged v1-layout key", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);

      await store.putDraft(makeValidDraftV2({ version: 2 }));

      expect(bucket.putKeys).toEqual([
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
      ]);
      // The `/v1/` segment is the KEY-LAYOUT version, not the draft schema
      // version. Renaming it would orphan historical objects.
      expect(bucket.putKeys[0]).toBe(
        `temp/character-sheets/v1/sessions/${SESSION_ID}/drafts/${DRAFT_ID}/v2.json`,
      );
      expect(bucket.putKeys[0]).not.toContain("/v2/");
    });

    it("3. applies no-store JSON metadata", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);

      await store.putDraft(makeValidDraftV2());

      const stored = bucket.objects.get(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
      );
      expect(stored?.contentType).toBe("application/json; charset=utf-8");
      expect(stored?.cacheControl).toBe("no-store");
    });

    it("4. rejects a V1 draft as invalid_draft before touching the bucket", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      const v1 = makeValidDraftV1();

      // A V1 draft is structurally not a canonical V2 write input. 4E1 forbids
      // canonicalizing on write, so this must be rejected, not migrated.
      await expectDraftErrorCode(
        () => store.putDraft(v1 as unknown as CharacterSheetDraftV2),
        "invalid_draft",
      );
      expect(bucket.putKeys).toHaveLength(0);
    });

    it("5. rejects an invalid V2 draft before touching the bucket", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      const broken = { ...makeValidDraftV2(), values: { unknown_field: 1 } };

      await expectDraftErrorCode(
        () => store.putDraft(broken as CharacterSheetDraftV2),
        "invalid_draft",
      );
      expect(bucket.putKeys).toHaveLength(0);
    });

    it("6. surfaces a put failure as storage_unavailable", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      bucket.failPutCall(1);

      await expectDraftErrorCode(
        () => store.putDraft(makeValidDraftV2()),
        "storage_unavailable",
      );
    });
  });

  describe("READ — V1/V2 migration at the canonical boundary", () => {
    it("7. canonicalizes a stored V1 snapshot to V2 on read", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV1()),
      );

      const read = await store.getDraftVersion(identityFor(), 1);

      expect(read?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
      expect(read?.characterName).toBe("Aria Stone");
      expect(read?.structure).toEqual([
        { kind: "field", key: "character_name", parentKey: null },
      ]);
    });

    it("8. performs ZERO writes when migrating a stored V1 snapshot", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV1()),
      );
      const originalBytes = bucket.objects.get(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
      )?.bytes;

      await store.getDraftVersion(identityFor(), 1);
      await store.getLatestDraft(identityFor());

      // Read migration is in-memory only; the historical bytes are untouched.
      expect(bucket.putKeys).toHaveLength(0);
      expect(
        bucket.objects.get(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1))?.bytes,
      ).toEqual(originalBytes);
    });

    it("9. reads a mixed V1/V2 history and always returns V2", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV1()),
      );
      await store.putDraft(makeValidDraftV2({ version: 2 }));

      const v1Read = await store.getDraftVersion(identityFor(), 1);
      const v2Read = await store.getDraftVersion(identityFor(), 2);
      const latest = await store.getLatestDraft(identityFor());

      expect(v1Read?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
      expect(v2Read?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
      expect(latest?.version).toBe(2);
    });

    it("10. a write AFTER a stored V1 snapshot persists V2", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV1()),
      );

      await store.putDraft(makeValidDraftV2({ version: 2 }));

      // Version history stays continuous: V1 at v1, V2 at v2.
      expect(await store.listDraftVersions(identityFor())).toEqual([1, 2]);
      const storedV2 = bucket.objects.get(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
      );
      expect(
        (
          JSON.parse(
            new TextDecoder().decode(storedV2?.bytes ?? new Uint8Array()),
          ) as {
            schemaVersion: string;
          }
        ).schemaVersion,
      ).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
      // The historical V1 bytes are still V1.
      const storedV1 = bucket.objects.get(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
      );
      expect(
        (
          JSON.parse(
            new TextDecoder().decode(storedV1?.bytes ?? new Uint8Array()),
          ) as {
            schemaVersion: string;
          }
        ).schemaVersion,
      ).toBe("1");
    });

    it("11. preserves the version across canonicalization", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 7),
        JSON.stringify(makeValidDraftV1({ version: 7 })),
      );

      const read = await store.getDraftVersion(identityFor(), 7);

      expect(read?.version).toBe(7);
    });

    it("12. returns null for a missing exact version", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await store.putDraft(makeValidDraftV2({ version: 1 }));

      // Missing is not-found, never corruption and never a migration event.
      expect(await store.getDraftVersion(identityFor(), 99)).toBeNull();
    });

    it("13. returns null for a draft identity with no stored history", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);

      expect(await store.getLatestDraft(identityFor())).toBeNull();
      expect(await store.listDraftVersions(identityFor())).toEqual([]);
    });
  });

  describe("READ — corruption detection", () => {
    it("14. maps malformed JSON to corrupt_draft, not SyntaxError", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        "{not json",
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("15. maps an invalid stored V1 payload to corrupt_draft, not invalid_draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      // schemaVersion "1" with a broken V1 body: the legacy parse must fail.
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify({ schemaVersion: "1", version: "not-a-number" }),
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("16. maps an invalid stored V2 payload to corrupt_draft, not invalid_draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify({
          schemaVersion: CHARACTER_SHEET_DRAFT_V2_VERSION,
          values: { unknown_field: 1 },
        }),
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("17. rejects a session id mismatch as corrupt_draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      // Key is derived from SESSION_ID, but the payload belongs to another session.
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV2({ sessionId: "a-different-session" })),
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("18. rejects a draft id mismatch as corrupt_draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV2({ draftId: "a-different-draft" })),
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("19. rejects a version mismatch as corrupt_draft", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      // Stored under the v1 key but the payload claims version 5.
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV2({ version: 5 })),
      );

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "corrupt_draft",
      );
    });

    it("20. surfaces a get failure as storage_unavailable", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      bucket.failGetCall(1);

      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "storage_unavailable",
      );
    });

    it("21. surfaces an object body-read failure as storage_unavailable", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await store.putDraft(makeValidDraftV2());
      bucket.failText();

      // A body-read failure is a storage fault, not stored corruption.
      await expectDraftErrorCode(
        () => store.getDraftVersion(identityFor(), 1),
        "storage_unavailable",
      );
    });
  });

  describe("VERSION LISTING", () => {
    it("22. lists ascending deduplicated versions and ignores unknown keys", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      const prefix = getDraftPrefix(SESSION_ID, DRAFT_ID);
      // Descending insertion order, a double-digit version, and future keys.
      await store.putDraft(makeValidDraftV2({ version: 10 }));
      await store.putDraft(makeValidDraftV2({ version: 2 }));
      await store.putDraft(makeValidDraftV2({ version: 9 }));
      await bucket.seed(`${prefix}notes.txt`, "not a snapshot");
      await bucket.seed(`${prefix}latest.json`, "{}");
      await bucket.seed(`${prefix}v3.txt`, "not a snapshot");

      // v10 must sort after v9 numerically, not lexicographically.
      expect(await store.listDraftVersions(identityFor())).toEqual([2, 9, 10]);
    });

    it("23. lists only the exact draft prefix", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await store.putDraft(makeValidDraftV2({ version: 1 }));
      await store.putDraft(
        makeValidDraftV2({ version: 4, draftId: `${DRAFT_ID}-sibling` }),
      );

      expect(await store.listDraftVersions(identityFor())).toEqual([1]);
      expect(
        await store.listDraftVersions(
          identityFor({ draftId: `${DRAFT_ID}-sibling` }),
        ),
      ).toEqual([4]);
    });

    it("24. pages through a version list larger than one page", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      for (const version of [1, 2, 3, 4, 5]) {
        await store.putDraft(makeValidDraftV2({ version }));
      }

      expect(await store.listDraftVersions(identityFor())).toEqual([
        1, 2, 3, 4, 5,
      ]);
    });

    it("25. surfaces a list failure as storage_unavailable", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      bucket.failList();

      await expectDraftErrorCode(
        () => store.listDraftVersions(identityFor()),
        "storage_unavailable",
      );
    });
  });

  describe("LATEST RESOLUTION", () => {
    it("26. resolves the highest NUMERIC version across a mixed history", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await bucket.seed(
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
        JSON.stringify(makeValidDraftV1({ version: 1 })),
      );
      await store.putDraft(makeValidDraftV2({ version: 10 }));
      await store.putDraft(makeValidDraftV2({ version: 9 }));

      const latest = await store.getLatestDraft(identityFor());

      expect(latest?.version).toBe(10);
      expect(latest?.schemaVersion).toBe(CHARACTER_SHEET_DRAFT_V2_VERSION);
    });

    it("27. returns null when no versions exist", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);

      expect(await store.getLatestDraft(identityFor())).toBeNull();
    });
  });

  describe("DELETE", () => {
    it("28. deletes every version across pages and preserves sibling ids", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      for (const version of [1, 2, 3, 4, 5]) {
        await store.putDraft(makeValidDraftV2({ version }));
      }
      await store.putDraft(
        makeValidDraftV2({ version: 9, draftId: `${DRAFT_ID}-sibling` }),
      );

      await store.deleteDraft(identityFor());

      expect(
        remainingUnder(bucket, getDraftPrefix(SESSION_ID, DRAFT_ID)),
      ).toEqual([]);
      // The trailing slash in the prefix keeps the sibling out of the sweep.
      expect(
        remainingUnder(
          bucket,
          getDraftPrefix(SESSION_ID, `${DRAFT_ID}-sibling`),
        ),
      ).toHaveLength(1);
    });

    it("29. delete is idempotent on an empty prefix", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);

      await store.deleteDraft(identityFor());
      await store.deleteDraft(identityFor());

      expect(await store.listDraftVersions(identityFor())).toEqual([]);
    });

    it("30. surfaces a delete failure as cleanup_failed", async () => {
      const bucket = new FakeR2Bucket();
      const store = createR2CharacterSheetDraftStoreV2(bucket);
      await store.putDraft(makeValidDraftV2());
      bucket.failDelete();

      await expectDraftErrorCode(
        () => store.deleteDraft(identityFor()),
        "cleanup_failed",
      );
    });
  });

  describe("NO RUNTIME CUTOVER — V1 adapter stays live", () => {
    it("31. the V1 adapter still serves a V2 payload via the V1 canonical path", async () => {
      // 4E1 adds a parallel port and adapter only. The live V1 adapter is
      // untouched and remains wired in production.
      const bucket = new FakeR2Bucket();
      const v1Store = createR2CharacterSheetDraftStore(bucket);

      await v1Store.putDraft(makeValidDraftV1({ version: 1 }));

      expect(await v1Store.getDraftVersion(identityFor(), 1)).toMatchObject({
        schemaVersion: "1",
        version: 1,
      });
    });

    it("32. the V2 adapter and the V1 adapter do not leak into each other", async () => {
      const bucket = new FakeR2Bucket();
      const v2Store: CharacterSheetDraftStoreV2 =
        createR2CharacterSheetDraftStoreV2(bucket);

      // The V2 adapter writes V2 bytes; the V1 adapter is never invoked by it,
      // so no V1-shaped put happens.
      await v2Store.putDraft(makeValidDraftV2({ version: 1 }));

      expect(bucket.putKeys).toEqual([
        getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
      ]);
    });
  });
});
