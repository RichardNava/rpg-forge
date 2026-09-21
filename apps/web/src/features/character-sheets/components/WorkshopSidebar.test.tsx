// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialDraftVersion } from "@repo/character-sheet-draft";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyWorkshopDrop, WorkshopSidebar } from "./WorkshopSidebar";

describe("WorkshopSidebar", () => {
  afterEach(cleanup);
  it("groups nested fields and renders bounded numeric controls compactly", () => {
    const draft = initialDraftVersion({
      schemaVersion: "1",
      draftId: "draft.sidebar",
      sessionId: "session.sidebar",
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
        { key: "attributes", title: "Attributes", fieldKeys: [] },
        {
          key: "physical",
          title: "Physical",
          parentKey: "attributes",
          fieldKeys: ["strength"],
        },
        {
          key: "body",
          title: "Body",
          parentKey: "physical",
          fieldKeys: [],
        },
      ],
      values: {},
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });
    render(
      <WorkshopSidebar
        draft={draft}
        disabled={false}
        callbacks={{
          onSetValue: vi.fn(),
          onClearValue: vi.fn(),
          onRemoveField: vi.fn(),
          onSetFieldLabel: vi.fn(),
          onSetFieldType: vi.fn(),
          onAddSection: vi.fn(),
          onRenameSection: vi.fn(),
          onMoveField: vi.fn(),
          onReparentSection: vi.fn(),
          onAddField: vi.fn(),
        }}
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

  it("maps drag destinations to the canonical field and section mutations", () => {
    const callbacks = { onMoveField: vi.fn(), onReparentSection: vi.fn() };
    applyWorkshopDrop(
      { kind: "field", key: "strength" },
      { kind: "section", key: "physical" },
      callbacks,
    );
    applyWorkshopDrop(
      { kind: "field", key: "strength" },
      { kind: "section", key: null },
      callbacks,
    );
    applyWorkshopDrop(
      { kind: "section", key: "physical" },
      { kind: "section", key: "attributes" },
      callbacks,
    );
    applyWorkshopDrop(
      { kind: "section", key: "physical" },
      { kind: "section", key: null },
      callbacks,
    );

    expect(callbacks.onMoveField).toHaveBeenNthCalledWith(
      1,
      "strength",
      "physical",
    );
    expect(callbacks.onMoveField).toHaveBeenNthCalledWith(2, "strength", null);
    expect(callbacks.onReparentSection).toHaveBeenNthCalledWith(
      1,
      "physical",
      "attributes",
    );
    expect(callbacks.onReparentSection).toHaveBeenNthCalledWith(
      2,
      "physical",
      null,
    );
  });

  it("offers keyboard-accessible structural controls through typed callbacks", () => {
    const draft = initialDraftVersion({
      schemaVersion: "1",
      draftId: "draft.structure",
      sessionId: "session.structure",
      mode: "pc",
      characterName: null,
      rulesContextId: null,
      fields: [{ key: "name", label: "Name", type: "text", locked: false }],
      sections: [
        { key: "details", title: "Details", fieldKeys: ["name"] },
        { key: "notes", title: "Notes", fieldKeys: [] },
      ],
      values: {},
      source: { sourceSheetId: null, sourceRunId: null },
      confirmed: false,
    });
    const callbacks = {
      onSetValue: vi.fn(),
      onClearValue: vi.fn(),
      onRemoveField: vi.fn(),
      onSetFieldLabel: vi.fn(),
      onSetFieldType: vi.fn(),
      onAddSection: vi.fn(),
      onRenameSection: vi.fn(),
      onMoveField: vi.fn(),
      onReparentSection: vi.fn(),
      onAddField: vi.fn(),
    };

    render(
      <WorkshopSidebar draft={draft} disabled={false} callbacks={callbacks} />,
    );

    fireEvent.click(
      screen.getByText("Field settings", { selector: "summary" }),
    );
    fireEvent.change(screen.getByLabelText("Label for Name"), {
      target: { value: "Hero name" },
    });
    fireEvent.change(screen.getByLabelText("Type for Name"), {
      target: { value: "choice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "A choice field needs at least one option.",
    );
    fireEvent.change(screen.getByLabelText("Options (one per line)"), {
      target: { value: "Warrior\nScholar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
    expect(callbacks.onSetFieldType).toHaveBeenCalledWith({
      key: "name",
      type: "choice",
      options: ["Warrior", "Scholar"],
    });
    expect(callbacks.onSetFieldLabel).toHaveBeenCalledWith("name", "Hero name");

    fireEvent.change(screen.getByLabelText("Assign Name to section"), {
      target: { value: "notes" },
    });
    expect(callbacks.onMoveField).toHaveBeenCalledWith("name", "notes");

    fireEvent.click(
      screen.getAllByText("Section settings", { selector: "summary" })[0]!,
    );
    fireEvent.change(screen.getByLabelText("Title for Details"), {
      target: { value: "Identity" },
    });
    fireEvent.blur(screen.getByLabelText("Title for Details"));
    expect(callbacks.onRenameSection).toHaveBeenCalledWith(
      "details",
      "Identity",
    );
    fireEvent.change(screen.getByLabelText("Parent section for Notes"), {
      target: { value: "details" },
    });
    expect(callbacks.onReparentSection).toHaveBeenCalledWith(
      "notes",
      "details",
    );
  });
});
