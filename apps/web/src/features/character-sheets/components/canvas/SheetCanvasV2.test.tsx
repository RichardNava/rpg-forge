// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialDraftVersionV2 } from "@repo/character-sheet-draft";
import type { CharacterSheetDraftV2 } from "@repo/character-sheet-draft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SheetCanvasV2 } from "./SheetCanvasV2";

describe("SheetCanvasV2", () => {
  afterEach(cleanup);

  function makeDraft(): CharacterSheetDraftV2 {
    return initialDraftVersionV2({
      schemaVersion: "2",
      draftId: "draft.canvas",
      sessionId: "session.canvas",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [
        { key: "a", label: "Alpha", type: "text", locked: false },
        { key: "b", label: "Beta", type: "text", locked: false },
        { key: "c", label: "Gamma", type: "text", locked: false },
      ],
      sections: [
        { key: "s1", title: "First" },
        { key: "s2", title: "Second" },
      ],
      structure: [
        { kind: "field", key: "a", parentKey: null },
        { kind: "section", key: "s1", parentKey: null },
        { kind: "field", key: "b", parentKey: "s1" },
        { kind: "section", key: "s2", parentKey: "s1" },
        { kind: "field", key: "c", parentKey: null },
      ],
      values: { a: "A", b: "B", c: "C" },
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
      layout: {
        schemaVersion: "1",
        root: { columns: 2 },
        sections: { s1: { columns: 2 }, s2: { columns: 1 } },
        nodes: {
          a: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          s1: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          b: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          s2: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
          c: { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
        },
      },
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
      onSetContainerLayout: vi.fn(),
      onSetNodeLayout: vi.fn(),
      onAddField: vi.fn(),
      onOpenAddSection: vi.fn(),
    };
  }

  function renderCanvas(
    overrides: Partial<Parameters<typeof SheetCanvasV2>[0]> = {},
  ) {
    const selectionState: {
      current:
        | { kind: "field"; key: string }
        | { kind: "section"; key: string }
        | null;
    } = { current: null };
    const utils = render(
      <SheetCanvasV2
        draft={makeDraft()}
        callbacks={callbacks()}
        disabled={false}
        selection={null}
        onSelectionChange={(selection) => {
          selectionState.current = selection;
        }}
        {...overrides}
      />,
    );
    return { ...utils, selectionState };
  }

  it("renders the root grid with nested sections in canonical order", () => {
    renderCanvas();
    expect(screen.getByRole("heading", { name: "Sheet canvas" })).toBeTruthy();
    // Canonical order: Alpha, First (with Beta, Second), Gamma.
    const canvas = screen.getByLabelText("Sheet canvas");
    const text = canvas.textContent ?? "";
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("First"));
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Beta"));
    expect(text.indexOf("Beta")).toBeLessThan(text.indexOf("Second"));
    expect(text.indexOf("Second")).toBeLessThan(text.indexOf("Gamma"));
    // Nested section exposes an inside target.
    expect(
      document.querySelector('[data-dnd-intent="canvas:inside:s1"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-dnd-intent="canvas:inside:root"]'),
    ).toBeTruthy();
  });

  it("renders before/after rails for fields and sections", () => {
    renderCanvas();
    expect(
      document.querySelector('[data-dnd-intent="canvas:before:field:a"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-dnd-intent="canvas:after:field:a"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-dnd-intent="canvas:before:section:s1"]'),
    ).toBeTruthy();
  });

  it("selects a field card on click", () => {
    const { selectionState } = renderCanvas();
    const card = document.querySelector('[data-canvas-node="a"]');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(selectionState.current).toEqual({ kind: "field", key: "a" });
  });

  it("selects a section on click", () => {
    const { selectionState } = renderCanvas();
    fireEvent.click(document.querySelector('[data-canvas-node="s1"]')!);
    expect(selectionState.current).toEqual({ kind: "section", key: "s1" });
  });

  it("marks the selected node without relying on color alone", () => {
    render(
      <SheetCanvasV2
        draft={makeDraft()}
        callbacks={callbacks()}
        disabled={false}
        selection={{ kind: "field", key: "a" }}
        onSelectionChange={() => {}}
      />,
    );
    const card = document.querySelector('[data-canvas-node="a"]');
    expect(card?.getAttribute("data-canvas-selected")).toBe("true");
    // Resize handles exist only on the selected node.
    expect(screen.getByLabelText("Width of Alpha")).toBeTruthy();
    expect(screen.queryByLabelText("Width of Beta")).toBeNull();
  });

  it("opens a keyboard move menu from the handle and commits", () => {
    const cb = callbacks();
    render(
      <SheetCanvasV2
        draft={makeDraft()}
        callbacks={cb}
        disabled={false}
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Move Alpha" }), {
      key: " ",
    });
    const dialog = screen.getByRole("dialog", { name: "Move Alpha" });
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Destination for Alpha"), {
      target: { value: "canvas:inside:s1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move here" }));
    expect(cb.onPlaceNode).toHaveBeenCalledWith("a", {
      position: "inside",
      parentKey: "s1",
    });
    expect(screen.queryByRole("dialog", { name: "Move Alpha" })).toBeNull();
  });

  it("cancels the keyboard move flow with Escape", () => {
    const cb = callbacks();
    render(
      <SheetCanvasV2
        draft={makeDraft()}
        callbacks={cb}
        disabled={false}
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
    const handle = screen.getByRole("button", { name: "Move Alpha" });
    fireEvent.keyDown(handle, { key: " " });
    expect(screen.getByRole("dialog", { name: "Move Alpha" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Move Alpha" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog", { name: "Move Alpha" })).toBeNull();
    expect(cb.onPlaceNode).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(handle);
  });

  it("commits slider steps through the resize handles", () => {
    const cb = callbacks();
    render(
      <SheetCanvasV2
        draft={makeDraft()}
        callbacks={cb}
        disabled={false}
        selection={{ kind: "field", key: "a" }}
        onSelectionChange={() => {}}
      />,
    );
    const width = screen.getByLabelText("Width of Alpha");
    fireEvent.keyDown(width, { key: "ArrowRight" });
    expect(cb.onSetNodeLayout).toHaveBeenCalledWith("a", {
      columnStart: 1,
      columnSpan: 2,
      rowSpan: 1,
      breakBefore: false,
    });
  });

  it("renders no editing chrome when confirmed", () => {
    const draft = { ...makeDraft(), confirmed: true };
    render(
      <SheetCanvasV2
        draft={draft}
        callbacks={callbacks()}
        disabled={true}
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Move Alpha" })).toBeNull();
    expect(document.querySelector("[data-dnd-intent]")).toBeNull();
    expect(screen.queryByLabelText("Width of Alpha")).toBeNull();
    // Content itself stays visible and identical.
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "First" })).toBeTruthy();
  });

  it("shows an empty inside target for empty sections", () => {
    const draft = makeDraft();
    const layoutNodes = { ...draft.layout!.nodes };
    delete layoutNodes["b"];
    const emptied: typeof draft = {
      ...draft,
      layout: { ...draft.layout!, nodes: layoutNodes },
      structure: draft.structure.filter((placement) => placement.key !== "b"),
      fields: draft.fields.filter((entry) => entry.key !== "b"),
      values: { a: "A", c: "C" },
    };
    render(
      <SheetCanvasV2
        draft={emptied}
        callbacks={callbacks()}
        disabled={false}
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
    // s2 has no children: usable inside target with guidance text.
    expect(screen.getByText("Drop fields or sections here")).toBeTruthy();
  });
});
