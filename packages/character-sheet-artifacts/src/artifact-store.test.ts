import { describe, expect, it } from "vitest";
import type { CharacterSheetSpec } from "@repo/character-sheet-schema";
import {
  CHARACTER_SHEET_ARTIFACT_ERROR_CODES,
  CharacterSheetArtifactError,
  type CharacterSheetArtifactIdentity,
  type CharacterSheetArtifactStore,
  type PutRunArtifactsInput,
} from "./index.js";
import { buildBaseSpec } from "./spec-fixture.js";

const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4 artifact test bytes with no valid trailer",
);

/** Reference in-memory store proving the port is directly implementable. */
class InMemoryArtifactStore implements CharacterSheetArtifactStore {
  private readonly specs = new Map<string, CharacterSheetSpec>();
  private readonly pdfs = new Map<string, Uint8Array>();

  private key(sessionId: string, runId: string): string {
    return `${sessionId}/${runId}`;
  }

  async putRunArtifacts({
    sessionId,
    runId,
    spec,
    pdfBytes,
  }: PutRunArtifactsInput): Promise<void> {
    this.specs.set(this.key(sessionId, runId), spec);
    this.pdfs.set(this.key(sessionId, runId), pdfBytes);
  }

  async getSpec({
    sessionId,
    runId,
  }: CharacterSheetArtifactIdentity): Promise<CharacterSheetSpec | null> {
    return this.specs.get(this.key(sessionId, runId)) ?? null;
  }

  async getPdfBytes({
    sessionId,
    runId,
  }: CharacterSheetArtifactIdentity): Promise<Uint8Array | null> {
    return this.pdfs.get(this.key(sessionId, runId)) ?? null;
  }

  async deleteRunArtifacts({
    sessionId,
    runId,
  }: CharacterSheetArtifactIdentity): Promise<void> {
    this.specs.delete(this.key(sessionId, runId));
    this.pdfs.delete(this.key(sessionId, runId));
  }

  async deleteSessionArtifacts(sessionId: string): Promise<void> {
    for (const key of this.specs.keys()) {
      if (key.startsWith(`${sessionId}/`)) {
        this.specs.delete(key);
        this.pdfs.delete(key);
      }
    }
  }
}

describe("CharacterSheetArtifactStore contract", () => {
  it("public API surface is exactly the five identity-keyed methods", () => {
    const publicMethods = Object.getOwnPropertyNames(
      InMemoryArtifactStore.prototype,
    ).filter((name) => name !== "constructor" && name !== "key");
    expect(new Set(publicMethods)).toEqual(
      new Set([
        "putRunArtifacts",
        "getSpec",
        "getPdfBytes",
        "deleteRunArtifacts",
        "deleteSessionArtifacts",
      ]),
    );
  });

  it("reference store round-trips a full run and cleans up", async () => {
    const store = new InMemoryArtifactStore();
    const spec = buildBaseSpec();
    const sessionId = "b15b4b3a-9a5f-4b6e-8d3c-1f7a6e2d4c0a";
    const runId = "c2d5c4e1-1b0a-4c2d-8e4f-2a8b9c0d1e2f";

    await store.putRunArtifacts({
      sessionId,
      runId,
      spec,
      pdfBytes: PDF_BYTES,
    });
    expect(await store.getSpec({ sessionId, runId })).toEqual(spec);
    expect(await store.getPdfBytes({ sessionId, runId })).toEqual(PDF_BYTES);

    await store.deleteRunArtifacts({ sessionId, runId });
    expect(await store.getSpec({ sessionId, runId })).toBeNull();
    expect(await store.getPdfBytes({ sessionId, runId })).toBeNull();
  });

  it("missing reads return null, not errors", async () => {
    const store = new InMemoryArtifactStore();
    expect(
      await store.getSpec({ sessionId: "missing", runId: "missing" }),
    ).toBeNull();
    expect(
      await store.getPdfBytes({ sessionId: "missing", runId: "missing" }),
    ).toBeNull();
  });

  it("deleteSessionArtifacts sweeps all runs of one session only", async () => {
    const store = new InMemoryArtifactStore();
    const sessionA = "11111111-1111-4111-8111-111111111111";
    const sessionB = "22222222-2222-4222-8222-222222222222";
    await store.putRunArtifacts({
      sessionId: sessionA,
      runId: "run-a-1",
      spec: buildBaseSpec(),
      pdfBytes: PDF_BYTES,
    });
    await store.putRunArtifacts({
      sessionId: sessionA,
      runId: "run-a-2",
      spec: buildBaseSpec(),
      pdfBytes: PDF_BYTES,
    });
    await store.putRunArtifacts({
      sessionId: sessionB,
      runId: "run-b-1",
      spec: buildBaseSpec(),
      pdfBytes: PDF_BYTES,
    });

    await store.deleteSessionArtifacts(sessionA);

    expect(
      await store.getSpec({ sessionId: sessionA, runId: "run-a-1" }),
    ).toBeNull();
    expect(
      await store.getSpec({ sessionId: sessionA, runId: "run-a-2" }),
    ).toBeNull();
    expect(
      await store.getSpec({ sessionId: sessionB, runId: "run-b-1" }),
    ).toEqual(buildBaseSpec());
  });

  it("exposes the bounded transport-neutral error taxonomy", () => {
    expect(CHARACTER_SHEET_ARTIFACT_ERROR_CODES).toEqual([
      "invalid_artifact_identity",
      "invalid_spec",
      "storage_unavailable",
      "corrupt_spec",
      "cleanup_failed",
    ]);
  });

  it("errors carry a code and a message", () => {
    const error = new CharacterSheetArtifactError(
      "storage_unavailable",
      "boom",
    );
    expect(error.code).toBe("storage_unavailable");
    expect(error.message).toBe("boom");
  });
});
