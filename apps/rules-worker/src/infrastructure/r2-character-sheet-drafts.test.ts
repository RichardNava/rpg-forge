import {
  DraftError,
  getDraftPrefix,
  getDraftSnapshotKey,
  type CharacterSheetDraft,
} from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import { createR2CharacterSheetDraftStore } from "./r2-character-sheet-drafts.js";
import type { R2BucketLike } from "./r2-character-sheet-artifacts.js";

type StoredValue = {
  bytes: Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
};

/** Deterministic in-memory bucket. list honors a small fixed page size so
 * deleteDraft pagination is exercised without 1000+ objects. */
class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, StoredValue>();
  readonly putKeys: string[] = [];
  private readonly pageSize = 2;
  private putCallCount = 0;
  private failPutOnCall: number | undefined;
  private failNextDelete = false;
  private failNextList = false;

  failPutCall(call: number): void {
    this.failPutOnCall = call;
  }

  failDelete(): void {
    this.failNextDelete = true;
  }

  failList(): void {
    this.failNextList = true;
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<void> {
    this.putKeys.push(key);
    this.putCallCount += 1;
    if (this.putCallCount === this.failPutOnCall) {
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
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return null;
    }
    return {
      text: async () => new TextDecoder().decode(stored.bytes),
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

function makeValidDraft(
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

describe("R2 character sheet draft store", () => {
  it("round-trips drafts with no-store headers and asc-ordered versions", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);

    const v1 = makeValidDraft({ version: 1 });
    const v2 = makeValidDraft({
      version: 2,
      characterName: "Aria Stone II",
      values: { character_name: "Aria Stone II" },
    });
    await store.putDraft(v1);
    await store.putDraft(v2);

    expect(
      await store.getDraftVersion(
        { sessionId: SESSION_ID, draftId: DRAFT_ID },
        1,
      ),
    ).toEqual(v1);
    expect(
      await store.getDraftVersion(
        { sessionId: SESSION_ID, draftId: DRAFT_ID },
        2,
      ),
    ).toEqual(v2);
    expect(
      await store.getLatestDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).toEqual(v2);
    expect(
      await store.listDraftVersions({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
      }),
    ).toEqual([1, 2]);

    const snapshot = bucket.objects.get(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 2),
    );
    expect(snapshot?.contentType).toBe("application/json; charset=utf-8");
    expect(snapshot?.cacheControl).toBe("no-store");
  });

  it("returns null for missing versions and empty version lists", async () => {
    const store = createR2CharacterSheetDraftStore(new FakeR2Bucket());

    expect(
      await store.getDraftVersion(
        { sessionId: SESSION_ID, draftId: DRAFT_ID },
        1,
      ),
    ).toBeNull();
    expect(
      await store.getLatestDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).toBeNull();
    expect(
      await store.listDraftVersions({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
      }),
    ).toEqual([]);
  });

  it("rejects an invalid draft on put before any storage call", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);

    await expect(
      store.putDraft(makeValidDraft({ version: 0 })),
    ).rejects.toMatchObject({ code: "invalid_draft" });
    expect(bucket.objects.size).toBe(0);
  });

  it("rejects an invalid identity before any storage call", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);

    await expect(
      store.putDraft(makeValidDraft({ draftId: "a/b" })),
    ).rejects.toMatchObject({ code: "invalid_draft" });
    expect(bucket.objects.size).toBe(0);

    await expect(
      store.getDraftVersion({ sessionId: SESSION_ID, draftId: ".." }, 1),
    ).rejects.toMatchObject({ code: "invalid_draft_identity" });
  });

  it("maps a corrupt stored snapshot to corrupt_draft", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    await bucket.put(getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1), "{not json");

    await expect(
      store.getDraftVersion({ sessionId: SESSION_ID, draftId: DRAFT_ID }, 1),
    ).rejects.toMatchObject({ code: "corrupt_draft" });
  });

  it("re-validates stored drafts and rejects schema-invalid payloads", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    await bucket.put(
      getDraftSnapshotKey(SESSION_ID, DRAFT_ID, 1),
      JSON.stringify({ schemaVersion: "9" }),
    );

    await expect(
      store.getDraftVersion({ sessionId: SESSION_ID, draftId: DRAFT_ID }, 1),
    ).rejects.toMatchObject({ code: "corrupt_draft" });
  });

  it("maps first-PUT failure to storage_unavailable", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(1);
    const store = createR2CharacterSheetDraftStore(bucket);

    await expect(store.putDraft(makeValidDraft())).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(bucket.objects.size).toBe(0);
  });

  it("maps list failure to storage_unavailable on reads", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    await store.putDraft(makeValidDraft());
    bucket.failList();

    await expect(
      store.listDraftVersions({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
  });

  it("maps delete failure to cleanup_failed and keeps the draft", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    await store.putDraft(makeValidDraft());
    bucket.failDelete();

    await expect(
      store.deleteDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });
    expect(
      await store.getLatestDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).toEqual(makeValidDraft());
  });

  it("ignores non-snapshot keys when listing versions", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    const prefix = getDraftPrefix(SESSION_ID, DRAFT_ID);
    await store.putDraft(makeValidDraft({ version: 2 }));
    await bucket.put(`${prefix}future-artifact.bin`, "x");

    expect(
      await store.listDraftVersions({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
      }),
    ).toEqual([2]);
    expect(
      await store.getLatestDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID }),
    ).toEqual(makeValidDraft({ version: 2 }));
  });

  it("deleteDraft wipes all versions across multiple list pages", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    const prefix = getDraftPrefix(SESSION_ID, DRAFT_ID);

    for (let version = 1; version <= 5; version += 1) {
      await store.putDraft(makeValidDraft({ version }));
    }

    await store.deleteDraft({ sessionId: SESSION_ID, draftId: DRAFT_ID });

    expect(remainingUnder(bucket, prefix)).toEqual([]);
    expect(
      await store.listDraftVersions({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
      }),
    ).toEqual([]);
  });

  it("deleteDraft preserves similar-prefix drafts", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetDraftStore(bucket);
    await store.putDraft(makeValidDraft({ draftId: "draft-short" }));
    await store.putDraft(makeValidDraft({ draftId: "draft-shorter" }));

    await store.deleteDraft({ sessionId: SESSION_ID, draftId: "draft-short" });

    expect(
      remainingUnder(bucket, getDraftPrefix(SESSION_ID, "draft-short")),
    ).toEqual([]);
    expect(
      await store.getLatestDraft({
        sessionId: SESSION_ID,
        draftId: "draft-shorter",
      }),
    ).toEqual(makeValidDraft({ draftId: "draft-shorter" }));
  });

  it("throws typed DraftError instances", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(1);
    const store = createR2CharacterSheetDraftStore(bucket);

    await expect(store.putDraft(makeValidDraft())).rejects.toBeInstanceOf(
      DraftError,
    );
  });
});
