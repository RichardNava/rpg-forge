// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialDraftVersionV2 } from "@repo/character-sheet-draft";
import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasInspectorV2 } from "./CanvasInspectorV2";

describe("CanvasInspectorV2", () => {
  afterEach(cleanup);

  function makeDraft(): CharacterSheetDraftV2 {
    return initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.inspector",
      sessionId: "session.inspector",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [
        { key: "a", label: "Alpha", type: "text", locked: false },
        { key: "b", label: "Beta", type: "number", locked: false },
      ],
      sections: [{ key: "s1", title: "First" }],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "section", key: "s1", parentKey: null },
        { kind: "field", key: "b", parentKey: "s1" },
      ],
      values: { a: "A" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { s1: { columns: 2 } },
        nodes: {
          a: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          s1: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          b: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
      },
    });
  }

  function callbacks() {
    return {
      onSetValue: vi.fn(),
      onClearValue: vi.fn(),
      onRemoveField: vi.fn(),
      onConfirmDeleteField: vi.fn(),
      onCancelDelete: vi.fn(),
      onRemoveSection: vi.fn(),
      onConfirmDeleteSection: vi.fn(),
      onSetFieldLabel: vi.fn(),
      onSetFieldType: vi.fn(),
      onRenameSection: vi.fn(),
      onPlaceNode: vi.fn(),
      onSetContainerLayout: vi.fn(),
      onSetNodeLayout: vi.fn(),
      onAddField: vi.fn(),
      onOpenAddSection: vi.fn(),
      onRemovePortraitSlot: vi.fn(),
      onSetPortraitAspectRatio: vi.fn(),
    };
  }

  function labelOf(draft: CharacterSheetDraftV2) {
    return (key: string): string =>
      draft.fields.find((entry) => entry.key === key)?.label ??
      draft.sections.find((entry) => entry.key === key)?.title ??
      key;
  }

  it("shows the sheet overview with root columns when nothing is selected", () => {
    const draft = makeDraft();
    const cb = callbacks();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={null}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    expect(screen.getByText("Sheet")).toBeTruthy();
    const columns = screen.getByLabelText(
      "Sheet columns",
    ) as unknown as HTMLSelectElement;
    expect(columns.value).toBe("2");
    fireEvent.change(columns, { target: { value: "3" } });
    expect(cb.onSetContainerLayout).toHaveBeenCalledWith(null, 3);
  });

  it("inspects the selected field with editing and geometry", () => {
    const draft = makeDraft();
    const cb = callbacks();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "field", key: "a" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    expect(screen.getByText("Field: Alpha")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Label for a"), {
      target: { value: "Alpha Prime" },
    });
    fireEvent.blur(screen.getByLabelText("Label for a"));
    expect(cb.onSetFieldLabel).toHaveBeenCalledWith("a", "Alpha Prime");

    fireEvent.change(screen.getByLabelText("Type for Alpha"), {
      target: { value: "textarea" },
    });
    expect(cb.onSetFieldType).toHaveBeenCalledWith({
      key: "a",
      type: "textarea",
    });

    const start = screen.getByLabelText("Column start for Alpha");
    fireEvent.change(start, { target: { value: "2" } });
    expect(cb.onSetNodeLayout).toHaveBeenCalledWith("a", {
      columnStart: 2,
      columnSpan: 1,
      rowSpan: 1,
      breakBefore: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove field" }));
    expect(cb.onRemoveField).toHaveBeenCalledWith("a");
  });

  it("moves the selected field through the inspector move control", () => {
    const draft = makeDraft();
    const cb = callbacks();
    const { container } = render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "field", key: "a" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    const select = container.querySelector(
      'select[aria-label="Move destination"]',
    ) as unknown as HTMLSelectElement;
    expect(select).toBeTruthy();
    const inside = [...select.options].find((option) =>
      option.text.startsWith("Inside"),
    );
    expect(inside).toBeTruthy();
    fireEvent.change(select, { target: { value: inside!.value } });
    fireEvent.click(screen.getByRole("button", { name: "Move here" }));
    expect(cb.onPlaceNode).toHaveBeenCalledWith("a", {
      position: "inside",
      parentKey: "s1",
    });
  });

  it("inspects the selected section with title, parent, and columns", () => {
    const draft = makeDraft();
    const cb = callbacks();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "section", key: "s1" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    expect(screen.getByText("Section: First")).toBeTruthy();
    expect(screen.getByText("Inside Top level")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Title for First"), {
      target: { value: "Prime" },
    });
    fireEvent.blur(screen.getByLabelText("Title for First"));
    expect(cb.onRenameSection).toHaveBeenCalledWith("s1", "Prime");

    fireEvent.change(screen.getByLabelText("Columns for First"), {
      target: { value: "3" },
    });
    expect(cb.onSetContainerLayout).toHaveBeenCalledWith("s1", 3);
  });

  it("changes placement through the visual mini-grid", () => {
    const draft = makeDraft();
    const cb = callbacks();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "field", key: "b" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Column 2 of 2 for Beta" }),
    );
    expect(cb.onSetNodeLayout).toHaveBeenCalledWith("b", {
      columnStart: 2,
      columnSpan: 1,
      rowSpan: 1,
      breakBefore: false,
    });
  });

  function makeSlottedDraft(): CharacterSheetDraftV2 {
    return initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.inspector.slot",
      sessionId: "session.inspector.slot",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [
        { key: "a", label: "Alpha", type: "text", locked: false },
        { key: "b", label: "Beta", type: "number", locked: false },
      ],
      sections: [{ key: "s1", title: "First" }],
      slots: [{ key: "portrait", type: "portrait" }],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "section", key: "s1", parentKey: null },
        { kind: "field", key: "b", parentKey: "s1" },
        { kind: "slot", key: "portrait", parentKey: "s1" },
      ],
      values: { a: "A" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { s1: { columns: 2 } },
        nodes: {
          a: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          s1: { columnStart: 1, columnSpan: 2, rowSpan: 1, breakBefore: false },
          b: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          portrait: { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
        slotDetails: { portrait: { aspectRatio: "3:4" } },
      },
    });
  }

  it("inspects the selected portrait slot with aspect, geometry, and remove", () => {
    const draft = makeSlottedDraft();
    const cb = callbacks();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "slot", key: "portrait" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    expect(screen.getByText("Portrait slot")).toBeTruthy();
    expect(
      document.querySelector(".canvas-inspector__meta")?.textContent,
    ).toBe("Inside First");

    const aspect = screen.getByLabelText(
      "Aspect ratio for Portrait slot",
    ) as unknown as HTMLSelectElement;
    expect(aspect.value).toBe("3:4");
    fireEvent.change(aspect, { target: { value: "1:1" } });
    expect(cb.onSetPortraitAspectRatio).toHaveBeenCalledWith("portrait", "1:1");

    const start = screen.getByLabelText("Column start for Portrait slot");
    fireEvent.change(start, { target: { value: "1" } });
    expect(cb.onSetNodeLayout).toHaveBeenCalledWith("portrait", {
      columnStart: 1,
      columnSpan: 1,
      rowSpan: 1,
      breakBefore: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove portrait slot" }));
    expect(cb.onRemovePortraitSlot).toHaveBeenCalledWith("portrait");
  });

  it("moves the selected slot through the inspector move control", () => {
    const draft = makeSlottedDraft();
    const cb = callbacks();
    const { container } = render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "slot", key: "portrait" }}
        callbacks={cb}
        disabled={false}
        labelOf={labelOf(draft)}
      />,
    );
    const select = container.querySelector(
      'select[aria-label="Move destination"]',
    ) as unknown as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "canvas:inside:root" } });
    fireEvent.click(screen.getByRole("button", { name: "Move here" }));
    expect(cb.onPlaceNode).toHaveBeenCalledWith("portrait", {
      position: "inside",
      parentKey: null,
    });
  });

  it("renders read-only context when confirmed", () => {
    const draft = makeDraft();
    render(
      <CanvasInspectorV2
        draft={draft}
        selection={{ kind: "field", key: "a" }}
        callbacks={callbacks()}
        disabled={true}
        labelOf={labelOf(draft)}
      />,
    );
    expect(screen.getByText("Field: Alpha")).toBeTruthy();
    expect(screen.queryByLabelText("Label for a")).toBeNull();
    expect(screen.queryByLabelText("Column start for a")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove field" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move here" })).toBeNull();
  });
});
