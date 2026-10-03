// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { initialDraftVersionV2 } from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import { SheetPreviewV2 } from "./SheetPreviewV2";

describe("SheetPreviewV2", () => {
  it("renders nested V2 sections in canonical mixed order without fieldKeys", () => {
    const draft = initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.preview-v2",
      sessionId: "session.preview-v2",
      mode: "pc",
      characterName: "Nyra",
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Name", type: "text", locked: false },
        {
          key: "strength",
          label: "Strength",
          type: "number",
          locked: false,
          min: 0,
          max: 5,
        },
        {
          key: "backgrounds",
          label: "Backgrounds",
          type: "list",
          locked: false,
        },
      ],
      sections: [
        { key: "attributes", title: "Attributes" },
        { key: "physical", title: "Physical" },
        { key: "details", title: "Details" },
      ],
      structure: [
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "section", key: "physical", parentKey: "attributes" },
        { kind: "field", key: "strength", parentKey: "physical" },
        { kind: "section", key: "details", parentKey: null },
        { kind: "field", key: "backgrounds", parentKey: "details" },
        { kind: "field", key: "character_name", parentKey: null },
      ],
      values: {
        character_name: "Nyra",
        backgrounds: ["First entry", "Second entry"],
      },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });

    render(<SheetPreviewV2 draft={draft} />);

    expect(screen.getByRole("heading", { name: "Attributes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Physical" })).toBeTruthy();
    expect(
      screen.getByText("Strength", {
        selector: ".character-workshop__preview-label",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.getByText("First entry · Second entry")).toBeTruthy();
  });

  it("rejects a malformed V2 draft safely", () => {
    const draft = initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.preview-v2",
      sessionId: "session.preview-v2",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Name", type: "text", locked: false },
      ],
      sections: [],
      structure: [{ kind: "field", key: "character_name", parentKey: null }],
      values: {},
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });

    render(
      <SheetPreviewV2 draft={{ ...draft, structure: [] } as typeof draft} />,
    );

    expect(
      screen.getByText("Preview unavailable for this draft."),
    ).toBeTruthy();
  });
});
