import {
  CharacterSheetArtifactError,
  getRunArtifactKeys,
  getRunArtifactPrefix,
  getSessionArtifactPrefix,
  type CharacterSheetSpec,
} from "@repo/character-sheet-artifacts";
import { describe, expect, it } from "vitest";
import {
  createR2CharacterSheetArtifactStore,
  type R2BucketLike,
} from "./r2-character-sheet-artifacts.js";

const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4 artifact test bytes with no valid trailer",
);

type StoredValue = {
  bytes: Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
};

/** Deterministic in-memory bucket. list honors a small fixed page size so
 * deleteSessionArtifacts pagination is exercised without 1000+ objects. */
class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, StoredValue>();
  readonly putKeys: string[] = [];
  private readonly pageSize = 2;
  private putCallCount = 0;
  private failPutOnCall: number | undefined;
  private failNextDelete = false;

  failPutCall(call: number): void {
    this.failPutOnCall = call;
  }

  failDelete(): void {
    this.failNextDelete = true;
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

function makeValidSpec(): CharacterSheetSpec {
  return {
    schemaVersion: "1",
    mode: "player",
    metadata: {
      id: "sheet.0001",
      title: "Artifact Test Sheet",
      description: null,
      locale: "en-US",
    },
    rulesContextId: null,
    pages: [
      {
        id: "page.1",
        layout: {
          orientation: "portrait",
          sizeIntent: null,
          sectionIds: ["identity"],
        },
      },
    ],
    sections: [
      {
        id: "identity",
        title: "Identity",
        layout: { mode: "flow", columns: 1, order: 0, emphasis: "normal" },
        fieldIds: ["character.name"],
      },
    ],
    fields: [
      {
        type: "text",
        id: "character.name",
        label: "Character Name",
        requiredForPlayableNpc: false,
        placement: {
          order: 0,
          columnStart: 1,
          columnSpan: 1,
          rowSpan: 1,
          breakBefore: false,
        },
      },
    ],
    values: {},
    theme: {
      style: "minimal",
      typography: "serif",
      density: "standard",
      borderStyle: "none",
      decorationIntensity: "none",
      accentColor: "#332211",
      backgroundIntent: "none",
    },
    sourceMap: {},
  } as CharacterSheetSpec;
}

function remainingUnder(bucket: FakeR2Bucket, prefix: string): string[] {
  return [...bucket.objects.keys()].filter((key) => key.startsWith(prefix));
}

describe("R2 character sheet artifact store", () => {
  const sessionId = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
  const runId = "c2d5c4e1-1b0a-4c2d-8e4f-2a8b9c0d1e2f";

  it("round-trips a run's spec and pdf with correct headers", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const spec = makeValidSpec();

    await store.putRunArtifacts({
      sessionId,
      runId,
      spec,
      pdfBytes: PDF_BYTES,
    });

    expect(await store.getSpec({ sessionId, runId })).toEqual(spec);
    expect(await store.getPdfBytes({ sessionId, runId })).toEqual(PDF_BYTES);

    const keys = getRunArtifactKeys(sessionId, runId);
    expect(bucket.objects.get(keys.spec)?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    expect(bucket.objects.get(keys.spec)?.cacheControl).toBe("no-store");
    expect(bucket.objects.get(keys.pdf)?.contentType).toBe("application/pdf");
    expect(bucket.objects.get(keys.pdf)?.cacheControl).toBe("no-store");
  });

  it("returns null for a missing spec or pdf", async () => {
    const store = createR2CharacterSheetArtifactStore(new FakeR2Bucket());
    expect(await store.getSpec({ sessionId, runId })).toBeNull();
    expect(await store.getPdfBytes({ sessionId, runId })).toBeNull();
  });

  it("maps a corrupt stored spec to corrupt_spec", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const keys = getRunArtifactKeys(sessionId, runId);
    await bucket.put(keys.spec, "{not json");

    await expect(store.getSpec({ sessionId, runId })).rejects.toMatchObject({
      code: "corrupt_spec",
    });
  });

  it("validates a stored spec against the schema and never returns partial data", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const keys = getRunArtifactKeys(sessionId, runId);
    await bucket.put(keys.spec, JSON.stringify({ schemaVersion: "9" }));

    await expect(store.getSpec({ sessionId, runId })).rejects.toMatchObject({
      code: "corrupt_spec",
    });
  });

  it("rejects an invalid identity before any storage call", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);

    await expect(
      store.putRunArtifacts({
        sessionId: "..",
        runId,
        spec: makeValidSpec(),
        pdfBytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: "invalid_artifact_identity" });
    expect(bucket.objects.size).toBe(0);

    await expect(store.getSpec({ sessionId, runId: "" })).rejects.toMatchObject(
      { code: "invalid_artifact_identity" },
    );
  });

  it("maps first-PUT failure to storage_unavailable and leaves zero objects", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(1);
    const store = createR2CharacterSheetArtifactStore(bucket);

    await expect(
      store.putRunArtifacts({
        sessionId,
        runId,
        spec: makeValidSpec(),
        pdfBytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(bucket.objects.size).toBe(0);
  });

  it("compensates a failed second PUT: storage_unavailable and zero objects remain", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(2);
    const store = createR2CharacterSheetArtifactStore(bucket);
    const keys = getRunArtifactKeys(sessionId, runId);

    await expect(
      store.putRunArtifacts({
        sessionId,
        runId,
        spec: makeValidSpec(),
        pdfBytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: "storage_unavailable" });

    expect(bucket.putKeys[0]).toBe(keys.spec);
    expect(bucket.putKeys[1]).toBe(keys.pdf);
    expect(bucket.objects.size).toBe(0);
    expect(
      remainingUnder(bucket, getRunArtifactPrefix(sessionId, runId)),
    ).toEqual([]);

    await store.putRunArtifacts({
      sessionId,
      runId,
      spec: makeValidSpec(),
      pdfBytes: PDF_BYTES,
    });
    expect(await store.getSpec({ sessionId, runId })).toEqual(makeValidSpec());
    expect(await store.getPdfBytes({ sessionId, runId })).toEqual(PDF_BYTES);
  });

  it("surfaces cleanup_failed when write compensation cleanup fails", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(2);
    bucket.failDelete();
    const store = createR2CharacterSheetArtifactStore(bucket);

    await expect(
      store.putRunArtifacts({
        sessionId,
        runId,
        spec: makeValidSpec(),
        pdfBytes: PDF_BYTES,
      }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });
  });

  it("deleteRunArtifacts wipes the whole run prefix including unknown artifacts", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const spec = makeValidSpec();
    const keys = getRunArtifactKeys(sessionId, runId);
    const otherRun = getRunArtifactKeys(sessionId, "run-other");

    await store.putRunArtifacts({
      sessionId,
      runId,
      spec,
      pdfBytes: PDF_BYTES,
    });
    await bucket.put(
      `${getRunArtifactPrefix(sessionId, runId)}future-artifact.bin`,
      "x",
    );
    await store.putRunArtifacts({
      sessionId,
      runId: "run-other",
      spec,
      pdfBytes: PDF_BYTES,
    });

    await store.deleteRunArtifacts({ sessionId, runId });

    expect(
      remainingUnder(bucket, getRunArtifactPrefix(sessionId, runId)),
    ).toEqual([]);
    expect(bucket.objects.has(keys.spec)).toBe(false);
    expect(bucket.objects.has(keys.pdf)).toBe(false);
    expect(await store.getSpec({ sessionId, runId: "run-other" })).toEqual(
      spec,
    );
    expect(bucket.objects.has(otherRun.spec)).toBe(true);
    expect(bucket.objects.has(otherRun.pdf)).toBe(true);
  });

  it("deleteRunArtifacts preserves similar-prefix runs", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const spec = makeValidSpec();

    await store.putRunArtifacts({
      sessionId,
      runId: "run-1",
      spec,
      pdfBytes: PDF_BYTES,
    });
    await store.putRunArtifacts({
      sessionId,
      runId: "run-10",
      spec,
      pdfBytes: PDF_BYTES,
    });

    await store.deleteRunArtifacts({ sessionId, runId: "run-1" });

    expect(
      remainingUnder(bucket, getRunArtifactPrefix(sessionId, "run-1")),
    ).toEqual([]);
    expect(await store.getSpec({ sessionId, runId: "run-10" })).toEqual(spec);
    expect(await store.getPdfBytes({ sessionId, runId: "run-10" })).toEqual(
      PDF_BYTES,
    );
  });

  it("sweeps every run of one run prefix across multiple list pages", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const runPrefix = getRunArtifactPrefix(sessionId, runId);

    for (let index = 0; index < 5; index += 1) {
      await bucket.put(`${runPrefix}artifact-${index}.bin`, "x");
    }

    await store.deleteRunArtifacts({ sessionId, runId });

    expect(remainingUnder(bucket, runPrefix)).toEqual([]);
  });

  it("maps delete failure to cleanup_failed", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const runPrefix = getRunArtifactPrefix(sessionId, runId);
    await bucket.put(`${runPrefix}spec.json`, "x");
    bucket.failDelete();

    await expect(
      store.deleteRunArtifacts({ sessionId, runId }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });
  });

  it("sweeps all runs of one session across multiple list pages", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const spec = makeValidSpec();

    const otherSession = "22222222-2222-4222-8222-222222222222";
    const repeatedRuns = Array.from(
      { length: 5 },
      (_, index) => `run-${index}`,
    );
    for (const id of repeatedRuns) {
      await store.putRunArtifacts({
        sessionId,
        runId: id,
        spec,
        pdfBytes: PDF_BYTES,
      });
    }
    await store.putRunArtifacts({
      sessionId: otherSession,
      runId: "keep-me",
      spec,
      pdfBytes: PDF_BYTES,
    });

    await store.deleteSessionArtifacts(sessionId);

    for (const id of repeatedRuns) {
      expect(await store.getSpec({ sessionId, runId: id })).toBeNull();
      expect(await store.getPdfBytes({ sessionId, runId: id })).toBeNull();
    }
    expect(
      await store.getSpec({ sessionId: otherSession, runId: "keep-me" }),
    ).toEqual(spec);
  });

  it("deleteSessionArtifacts preserves similar-prefix sessions", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2CharacterSheetArtifactStore(bucket);
    const spec = makeValidSpec();

    await store.putRunArtifacts({
      sessionId: "session-a",
      runId: "run-1",
      spec,
      pdfBytes: PDF_BYTES,
    });
    await store.putRunArtifacts({
      sessionId: "session-a2",
      runId: "run-1",
      spec,
      pdfBytes: PDF_BYTES,
    });

    await store.deleteSessionArtifacts("session-a");

    expect(
      remainingUnder(bucket, getSessionArtifactPrefix("session-a")),
    ).toEqual([]);
    expect(
      await store.getSpec({ sessionId: "session-a2", runId: "run-1" }),
    ).toEqual(spec);
    expect(
      await store.getPdfBytes({ sessionId: "session-a2", runId: "run-1" }),
    ).toEqual(PDF_BYTES);
  });

  it("throws typed CharacterSheetArtifactError instances", async () => {
    const bucket = new FakeR2Bucket();
    bucket.failPutCall(1);
    const store = createR2CharacterSheetArtifactStore(bucket);

    await expect(
      store.putRunArtifacts({
        sessionId,
        runId,
        spec: makeValidSpec(),
        pdfBytes: PDF_BYTES,
      }),
    ).rejects.toBeInstanceOf(CharacterSheetArtifactError);
  });
});
