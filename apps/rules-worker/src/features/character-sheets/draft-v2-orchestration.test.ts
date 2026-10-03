/**
 * 4E3A-R — tests for the internal V2 HTTP egress serializers.
 *
 * Scope is deliberately narrow. 4E3A-R removed `runDraftV2Operation`,
 * `draftErrorV2Response` and the `DraftV2Outcome` union, because they existed
 * only to adapt V2 domain errors as result unions. That premise was false: V2
 * domain operations THROW `DraftError` and are translated by the private
 * `draftErrorToResponse` in `character-sheet-handler.ts`. Those tests were
 * deleted with the code.
 *
 * Error-translation coverage now lives with the code that performs it, in
 * `character-sheet-handler.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import {
  draftV2CreatedResponse,
  draftV2RerollResponse,
  draftV2SnapshotResponse,
} from "./draft-v2-orchestration.js";

function makeV2Draft(): CharacterSheetDraftV2 {
  // V2 Sections carry ONLY key + title. Field placement lives in `structure[]`,
  // the sole structural authority; V1's `sections[].fieldKeys` and
  // `section.parentKey` have no V2 equivalent.
  return {
    schemaVersion: "2",
    draftId: "draft.abc123",
    sessionId: "session.abc123",
    baseVersion: 1,
    version: 2,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      { key: "character_name", label: "Name", type: "text", locked: false },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: true,
      },
    ],
    sections: [{ key: "core", title: "Core" }],
    structure: [
      { kind: "section", key: "core", parentKey: null },
      { kind: "field", key: "character_name", parentKey: "core" },
      { kind: "field", key: "strength", parentKey: "core" },
    ],
    values: { character_name: "Aria Stone", strength: 12 },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

describe("draft-v2-orchestration egress serialization", () => {
  it("emits a snapshot as the raw canonical V2 draft, not an envelope", async () => {
    const body = (await draftV2SnapshotResponse(
      makeV2Draft(),
    ).json()) as Record<string, unknown>;

    // Frozen 4D policy, and the deliberate correction to the previous confirm
    // route which wrapped as { draft: ... }.
    expect(body.schemaVersion).toBe("2");
    expect(body).not.toHaveProperty("draft");
  });

  it("leaves the snapshot version untouched", async () => {
    // A semantic no-op returns the EXACT original snapshot with an unchanged
    // version. The serializer must not disturb that, because the handler uses
    // the version comparison to decide whether to claim/write/commit at all.
    const draft = makeV2Draft();
    const body = (await draftV2SnapshotResponse(draft).json()) as {
      version: number;
      baseVersion: number;
    };

    expect(body.version).toBe(draft.version);
    expect(body.baseVersion).toBe(draft.baseVersion);
  });

  it("preserves an unchanged version for a no-op snapshot", async () => {
    // The frozen no-op bypass (no D1 claim, no R2 put) is keyed on
    // result.version === current.version; the serializer must not normalize,
    // advance, or otherwise hide that signal.
    const current = makeV2Draft();
    const noOp = { ...current, version: current.version };

    const body = (await draftV2SnapshotResponse(noOp).json()) as {
      version: number;
    };

    expect(body.version).toBe(current.version);
  });

  it("wraps a reroll result as { draft, rerolledKeys }", async () => {
    const draft = makeV2Draft();
    const body = (await draftV2RerollResponse({
      draft,
      rerolledKeys: ["strength"],
    }).json()) as { draft: CharacterSheetDraftV2; rerolledKeys: string[] };

    expect(body.draft.version).toBe(draft.version);
    expect(body.rerolledKeys).toEqual(["strength"]);
  });

  it("allows an empty rerolledKeys list", async () => {
    // Valid and meaningful: no Field had a draw grammar.
    const body = (await draftV2RerollResponse({
      draft: makeV2Draft(),
      rerolledKeys: [],
    }).json()) as { rerolledKeys: string[] };

    expect(body.rerolledKeys).toEqual([]);
  });

  it("rejects a non-canonical snapshot loudly instead of emitting it", () => {
    // Egress validation is the Worker-specific reason these helpers exist.
    // A non-canonical draft is a programmer defect, not a client condition, so
    // it fails loudly rather than becoming a 4xx.
    expect(() =>
      draftV2SnapshotResponse({ schemaVersion: "2", draftId: "draft.abc" }),
    ).toThrow();
  });

  it("emits a created snapshot as raw V2 with HTTP 201", async () => {
    const draft = makeV2Draft();
    const response = draftV2CreatedResponse(draft);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.schemaVersion).toBe("2");
    expect(body).not.toHaveProperty("draft");
  });

  it("rejects a non-canonical create body loudly instead of emitting it", () => {
    expect(() =>
      draftV2CreatedResponse({ schemaVersion: "2", draftId: "draft.abc" }),
    ).toThrow();
  });
});
