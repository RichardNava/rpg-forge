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

  it("renders explicit layout as nested grids with node geometry", () => {
    const draft = initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.preview-grid",
      sessionId: "session.preview-grid",
      mode: "pc",
      characterName: "Grid",
      rulesContextId: null,
      fields: [
        { key: "character_name", label: "Name", type: "text", locked: false },
        {
          key: "strength",
          label: "Strength",
          type: "number",
          locked: false,
        },
      ],
      sections: [{ key: "attributes", title: "Attributes" }],
      structure: [
        { kind: "field", key: "character_name", parentKey: null },
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "field", key: "strength", parentKey: "attributes" },
      ],
      values: { character_name: "Grid", strength: 12 },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { attributes: { columns: 2 } },
        nodes: {
          character_name: {
            columnStart: 1,
            columnSpan: 2,
            rowSpan: 1,
            breakBefore: false,
          },
          attributes: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: true,
          },
          strength: {
            columnStart: 1,
            columnSpan: 1,
            rowSpan: 1,
            breakBefore: false,
          },
        },
      },
    });

    const { container } = render(<SheetPreviewV2 draft={draft} />);

    const body = container.querySelector(".character-workshop__sheet-body");
    expect(body?.getAttribute("style")).toContain("repeat(2,");
    // breakBefore on the section emits a full-row breaker before it.
    const breakers = container.querySelectorAll('[aria-hidden="true"]');
    expect(breakers.length).toBe(1);
    expect(breakers[0]?.getAttribute("style")).toContain("grid-column: 1 / -1");
  });

  it("previews a layoutless draft with single-column defaults", () => {
    const draft = initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.preview-plain",
      sessionId: "session.preview-plain",
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

    const { container } = render(<SheetPreviewV2 draft={draft} />);

    const body = container.querySelector(".character-workshop__sheet-body");
    expect(body?.getAttribute("style")).toContain("repeat(1,");
    expect(screen.getByText("Untitled draft")).toBeTruthy();
  });
});
