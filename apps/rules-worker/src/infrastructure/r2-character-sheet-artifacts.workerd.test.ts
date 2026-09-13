import { createR2CharacterSheetArtifactStore } from "./r2-character-sheet-artifacts.js";
import {
  getRunArtifactKeys,
  getRunArtifactPrefix,
  type CharacterSheetSpec,
} from "@repo/character-sheet-artifacts";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

function bucket(): R2Bucket {
  const bound = env.SHEET_ARTIFACTS as R2Bucket | undefined;
  if (bound === undefined) {
    throw new Error("SHEET_ARTIFACTS binding is missing from env.local config");
  }
  return bound;
}

function makeValidSpec(): CharacterSheetSpec {
  return {
    schemaVersion: "1",
    mode: "player",
    metadata: {
      id: "sheet.0001",
      title: "Workerd Artifact Test Sheet",
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

describe("R2 character sheet artifact store (workerd)", () => {
  it("round-trips a run's spec and pdf with no-store headers", async () => {
    const store = createR2CharacterSheetArtifactStore(bucket());
    const spec = makeValidSpec();
    const sessionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const pdfBytes = new TextEncoder().encode(
      "%PDF-1.4 workerd artifact bytes",
    );

    await store.putRunArtifacts({ sessionId, runId, spec, pdfBytes });
    expect(await store.getSpec({ sessionId, runId })).toEqual(spec);
    expect(await store.getPdfBytes({ sessionId, runId })).toEqual(pdfBytes);

    const keys = getRunArtifactKeys(sessionId, runId);
    const specObject = await bucket().get(keys.spec);
    const pdfObject = await bucket().get(keys.pdf);
    expect(specObject?.httpMetadata?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    expect(specObject?.httpMetadata?.cacheControl).toBe("no-store");
    expect(pdfObject?.httpMetadata?.contentType).toBe("application/pdf");
    expect(pdfObject?.httpMetadata?.cacheControl).toBe("no-store");
  });

  it("deleteRunArtifacts wipes the whole run prefix including unknown artifacts", async () => {
    const store = createR2CharacterSheetArtifactStore(bucket());
    const spec = makeValidSpec();
    const sessionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const pdfBytes = new TextEncoder().encode(
      "%PDF-1.4 workerd artifact bytes",
    );

    await store.putRunArtifacts({ sessionId, runId, spec, pdfBytes });
    await bucket().put(
      `${getRunArtifactPrefix(sessionId, runId)}future-artifact.bin`,
      "x",
    );

    await store.deleteRunArtifacts({ sessionId, runId });

    expect(await store.getSpec({ sessionId, runId })).toBeNull();
    expect(await store.getPdfBytes({ sessionId, runId })).toBeNull();
    expect(
      await bucket().get(
        `${getRunArtifactPrefix(sessionId, runId)}future-artifact.bin`,
      ),
    ).toBeNull();
  });

  it("deleteSessionArtifacts removes every run of one session only", async () => {
    const store = createR2CharacterSheetArtifactStore(bucket());
    const spec = makeValidSpec();
    const sessionId = crypto.randomUUID();
    const otherSession = crypto.randomUUID();
    const pdfBytes = new TextEncoder().encode(
      "%PDF-1.4 workerd artifact bytes",
    );

    for (const runId of ["run-a", "run-b", "run-c"]) {
      await store.putRunArtifacts({ sessionId, runId, spec, pdfBytes });
    }
    await store.putRunArtifacts({
      sessionId: otherSession,
      runId: "keep-me",
      spec,
      pdfBytes,
    });

    await store.deleteSessionArtifacts(sessionId);

    for (const runId of ["run-a", "run-b", "run-c"]) {
      expect(await store.getSpec({ sessionId, runId })).toBeNull();
    }
    expect(
      await store.getSpec({ sessionId: otherSession, runId: "keep-me" }),
    ).toEqual(spec);
  });
});
