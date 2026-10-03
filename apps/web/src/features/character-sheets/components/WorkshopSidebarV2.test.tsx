// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialDraftVersionV2 } from "@repo/character-sheet-draft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyWorkshopDropV2, WorkshopSidebarV2 } from "./WorkshopSidebarV2";

describe("WorkshopSidebarV2", () => {
  afterEach(cleanup);

  function makeDraft() {
    return initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.sidebar-v2",
      sessionId: "session.sidebar-v2",
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
      ],
      sections: [
        { key: "attributes", title: "Attributes" },
        { key: "physical", title: "Physical" },
        { key: "body", title: "Body" },
      ],
      structure: [
        { kind: "section", key: "attributes", parentKey: null },
        { kind: "section", key: "physical", parentKey: "attributes" },
        { kind: "field", key: "strength", parentKey: "physical" },
        { kind: "section", key: "body", parentKey: "physical" },
        { kind: "field", key: "character_name", parentKey: null },
      ],
      values: {},
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });
  }

  function callbacks() {
    return {
      onSetValue: vi.fn(),
      onClearValue: vi.fn(),
      onRemoveField: vi.fn(),
      onSetFieldLabel: vi.fn(),
      onSetFieldType: vi.fn(),
      onRenameSection: vi.fn(),
      onPlaceNode: vi.fn(),
      onAddField: vi.fn(),
    };
  }

  it("renders nested V2 sections from the read model with mixed order", () => {
    render(
      <WorkshopSidebarV2
        draft={makeDraft()}
        disabled={false}
        callbacks={callbacks()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Attributes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Physical" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Body" })).toBeTruthy();
    const input = screen.getByLabelText("Strength");
    expect(input.getAttribute("type")).toBe("number");
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("5");
    expect(
      input.closest(".character-workshop__field-card--number"),
    ).toBeTruthy();
  });

  it("renders a field inside a section without fieldKeys", () => {
    render(
      <WorkshopSidebarV2
        draft={makeDraft()}
        disabled={false}
        callbacks={callbacks()}
      />,
    );
    // Strength lives inside Physical via structure[], not section.fieldKeys.
    const physical = screen
      .getByRole("heading", { name: "Physical" })
      .closest("section");
    expect(physical?.textContent).toContain("Strength");
  });

  it("maps drops to place_node inside destinations only", () => {
    const onPlaceNode = vi.fn();
    applyWorkshopDropV2(
      { kind: "field", key: "strength" },
      { kind: "section", key: "physical" },
      onPlaceNode,
    );
    applyWorkshopDropV2(
      { kind: "field", key: "strength" },
      { kind: "section", key: null },
      onPlaceNode,
    );
    applyWorkshopDropV2(
      { kind: "section", key: "physical" },
      { kind: "section", key: "attributes" },
      onPlaceNode,
    );
    // A section dropped onto itself is ignored.
    applyWorkshopDropV2(
      { kind: "section", key: "physical" },
      { kind: "section", key: "physical" },
      onPlaceNode,
    );

    expect(onPlaceNode).toHaveBeenCalledTimes(3);
    expect(onPlaceNode).toHaveBeenNthCalledWith(1, "strength", {
      position: "inside",
      parentKey: "physical",
    });
    expect(onPlaceNode).toHaveBeenNthCalledWith(2, "strength", {
      position: "inside",
      parentKey: null,
    });
    expect(onPlaceNode).toHaveBeenNthCalledWith(3, "physical", {
      position: "inside",
      parentKey: "attributes",
    });
  });

  it("reparents a section through place_node inside from the settings", () => {
    const cb = callbacks();
    const { container } = render(
      <WorkshopSidebarV2 draft={makeDraft()} disabled={false} callbacks={cb} />,
    );
    const select = container.querySelector(
      'select[aria-label="Parent section for Physical"]',
    ) as unknown as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "attributes" } });
    expect(cb.onPlaceNode).toHaveBeenCalledWith("physical", {
      position: "inside",
      parentKey: "attributes",
    });
  });
});
