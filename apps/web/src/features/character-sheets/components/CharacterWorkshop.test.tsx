// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterWorkshop } from "./CharacterWorkshop";

afterEach(() => {
  cleanup();
});

describe("CharacterWorkshop", () => {
  it("walks the manual creation loop: create, edit, add field, confirm, read-only", async () => {
    render(<CharacterWorkshop />);

    // Landing screen offers both creation modes.
    expect(
      screen.getByRole("heading", { name: /RPG Forge — Character sheets/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create manually/i }),
    ).toBeTruthy();

    // Choose manual creation.
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));

    // Workshop appears with the blank draft's single field and a title input.
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
      expect(
        screen.getByText("Character name", {
          selector: ".character-workshop__field-label",
        }),
      ).toBeTruthy();
    });

    // Renaming the sheet mirrors the preview title.
    const titleInput = screen.getByLabelText("Sheet title");
    fireEvent.change(titleInput, { target: { value: "Mara Thorn" } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mara Thorn" })).toBeTruthy();
    });

    // Add a number field through the dialog.
    fireEvent.click(screen.getByRole("button", { name: /^Add field$/i }));
    const dialog = screen.getByRole("dialog", { name: "Add a field" });
    fireEvent.change(within(dialog).getByLabelText("Label"), {
      target: { value: "Age" },
    });
    fireEvent.change(within(dialog).getByLabelText("Type"), {
      target: { value: "number" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^Add field$/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Age", {
          selector: ".character-workshop__field-label",
        }),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("dialog", { name: "Add a field" })).toBeNull();

    // The new field is editable and drives the preview.
    const ageInput = screen.getByLabelText("Age");
    fireEvent.change(ageInput, { target: { value: "29" } });
    await waitFor(() => {
      expect(
        screen.getByText("29", {
          selector: ".character-workshop__preview-value",
        }),
      ).toBeTruthy();
    });

    // Confirm transitions the sheet to read-only.
    fireEvent.click(screen.getByRole("button", { name: "Confirm sheet" }));
    const confirmDialog = screen.getByRole("dialog", {
      name: "Confirm character sheet",
    });
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Confirm sheet" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/confirmed and read-only/i)).toBeTruthy();
    });

    // Start a new sheet returns to the landing screen.
    fireEvent.click(screen.getByRole("button", { name: "Start a new sheet" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /RPG Forge — Character sheets/i }),
      ).toBeTruthy();
    });
  });

  it("shows domain-level rejection inside the add-field dialog", async () => {
    render(<CharacterWorkshop />);
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Add field$/i }));
    const dialog = screen.getByRole("dialog", { name: "Add a field" });

    // An invalid key (must start with a letter/digit) is rejected client-side.
    fireEvent.change(within(dialog).getByLabelText("Label"), {
      target: { value: "Name" },
    });
    fireEvent.change(within(dialog).getByLabelText("Key"), {
      target: { value: "-name" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^Add field$/i }),
    );

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByRole("dialog", { name: "Add a field" })).toBeTruthy();
  });
});
