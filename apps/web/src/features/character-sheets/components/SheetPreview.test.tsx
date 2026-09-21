// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { initialDraftVersion } from "@repo/character-sheet-draft";
import { describe, expect, it } from "vitest";
import { SheetPreview } from "./SheetPreview";

describe("SheetPreview", () => {
  it("renders nested section titles before their extracted fields", () => {
    const draft = initialDraftVersion({
      schemaVersion: "1",
      draftId: "draft.preview",
      sessionId: "session.preview",
      mode: "pc",
      characterName: null,
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
        { key: "attributes", title: "Attributes", fieldKeys: [] },
        {
          key: "physical",
          title: "Physical",
          parentKey: "attributes",
          fieldKeys: ["strength"],
        },
        { key: "details", title: "Details", fieldKeys: ["backgrounds"] },
      ],
      values: { backgrounds: ["First entry", "Second entry"] },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });

    render(<SheetPreview draft={draft} />);

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
});
