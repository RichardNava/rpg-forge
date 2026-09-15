import {
  getDraftSnapshotKey,
  type CharacterSheetDraft,
} from "@repo/character-sheet-draft";
import { type CharacterSheetSpec } from "@repo/character-sheet-artifacts";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createR2CharacterSheetArtifactStore } from "./r2-character-sheet-artifacts.js";
import { createR2CharacterSheetDraftStore } from "./r2-character-sheet-drafts.js";

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
      title: "Workerd Draft Test Sheet",
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

function makeValidDraft(
  sessionId: string,
  draftId: string,
  version: number,
): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId,
    sessionId,
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
    values: { character_name: "Aria Stone" },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  } as CharacterSheetDraft;
}

describe("R2 character sheet draft store (workerd)", () => {
  it("round-trips a session's draft versions with no-store headers", async () => {
    const store = createR2CharacterSheetDraftStore(bucket());
    const sessionId = crypto.randomUUID();
    const draftId = crypto.randomUUID();

    const v1 = makeValidDraft(sessionId, draftId, 1);
    const v2 = makeValidDraft(sessionId, draftId, 2);
    await store.putDraft(v1);
    await store.putDraft(v2);

    expect(await store.getDraftVersion({ sessionId, draftId }, 1)).toEqual(v1);
    expect(await store.getLatestDraft({ sessionId, draftId })).toEqual(v2);
    expect(await store.listDraftVersions({ sessionId, draftId })).toEqual([
      1, 2,
    ]);

    const object = await bucket().get(
      getDraftSnapshotKey(sessionId, draftId, 2),
    );
    expect(object?.httpMetadata?.contentType).toBe(
      "application/json; charset=utf-8",
    );
    expect(object?.httpMetadata?.cacheControl).toBe("no-store");

    await store.deleteDraft({ sessionId, draftId });
    expect(await store.getLatestDraft({ sessionId, draftId })).toBeNull();
  });

  it("regression: deleteSessionArtifacts also wipes the session's drafts", async () => {
    const artifacts = createR2CharacterSheetArtifactStore(bucket());
    const drafts = createR2CharacterSheetDraftStore(bucket());
    const spec = makeValidSpec();
    const pdfBytes = new TextEncoder().encode(
      "%PDF-1.4 workerd artifact bytes",
    );
    const sessionId = crypto.randomUUID();
    const otherSession = crypto.randomUUID();

    await artifacts.putRunArtifacts({
      sessionId,
      runId: "regression",
      spec,
      pdfBytes,
    });
    await drafts.putDraft(makeValidDraft(sessionId, "draft-one", 1));
    await drafts.putDraft(makeValidDraft(sessionId, "draft-two", 2));
    await drafts.putDraft(makeValidDraft(otherSession, "keep-me", 1));

    await artifacts.deleteSessionArtifacts(sessionId);

    expect(
      await artifacts.getSpec({ sessionId, runId: "regression" }),
    ).toBeNull();
    for (const draftId of ["draft-one", "draft-two"]) {
      expect(await drafts.getLatestDraft({ sessionId, draftId })).toBeNull();
    }
    expect(
      await drafts.getLatestDraft({
        sessionId: otherSession,
        draftId: "keep-me",
      }),
    ).toEqual(makeValidDraft(otherSession, "keep-me", 1));
    expect(
      await artifacts.getSpec({ sessionId: otherSession, runId: "keep-me" }),
    ).toBeNull();
  });

  it("single-draft deletion leaves sibling drafts and runs untouched", async () => {
    const artifacts = createR2CharacterSheetArtifactStore(bucket());
    const drafts = createR2CharacterSheetDraftStore(bucket());
    const spec = makeValidSpec();
    const sessionId = crypto.randomUUID();

    await artifacts.putRunArtifacts({
      sessionId,
      runId: "keep-run",
      spec,
      pdfBytes: new TextEncoder().encode("%PDF-1.4 bytes"),
    });
    await drafts.putDraft(makeValidDraft(sessionId, "remove-me", 1));
    await drafts.putDraft(makeValidDraft(sessionId, "keep-draft", 3));

    await drafts.deleteDraft({ sessionId, draftId: "remove-me" });

    expect(
      await drafts.getLatestDraft({ sessionId, draftId: "remove-me" }),
    ).toBeNull();
    expect(
      await drafts.getLatestDraft({ sessionId, draftId: "keep-draft" }),
    ).toEqual(makeValidDraft(sessionId, "keep-draft", 3));
    expect(await artifacts.getSpec({ sessionId, runId: "keep-run" })).toEqual(
      spec,
    );
  });
});
