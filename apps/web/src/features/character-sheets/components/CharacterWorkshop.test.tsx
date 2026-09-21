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

    // Landing screen opens with the three creation paths.
    expect(
      screen.getByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Upload existing sheet/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create manually/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Generate with AI/i }),
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

    // Renaming the sheet keeps the title input in sync without a persistent preview.
    const titleInput = screen.getByLabelText("Sheet title");
    fireEvent.change(titleInput, { target: { value: "Mara Thorn" } });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Sheet title") as HTMLInputElement).value,
      ).toBe("Mara Thorn");
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

    // The new field is editable directly in the single editor surface.
    const ageInput = screen.getByLabelText("Age");
    fireEvent.change(ageInput, { target: { value: "29" } });
    await waitFor(() =>
      expect((ageInput as HTMLInputElement).value).toBe("29"),
    );

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
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();

    // Start a new sheet returns to the landing screen.
    fireEvent.click(screen.getByRole("button", { name: "Start a new sheet" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /How do you want to create your character\?/i,
        }),
      ).toBeTruthy();
    });
  });

  it("shows the AI generation path as coming soon", () => {
    render(<CharacterWorkshop />);
    const aiChoice = screen.getByRole("button", { name: /Generate with AI/i });
    expect(aiChoice).toBeTruthy();
    expect(screen.getByText("Soon")).toBeTruthy();
  });

  it("opens the upload dialog and rejects unsupported documents", async () => {
    render(<CharacterWorkshop />);
    fireEvent.click(
      screen.getByRole("button", { name: /Upload existing sheet/i }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Upload an existing sheet",
    });

    const fileInput = within(dialog).getByLabelText("Sheet document");
    const textFile = new File(["notes"], "notes.txt", {
      type: "text/plain",
    });
    fireEvent.change(fileInput, { target: { files: [textFile] } });

    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toBeTruthy();
    });
    expect(within(dialog).getByText(/PDF, PNG and JPG/i)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Extract fields" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Upload an existing sheet" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeTruthy();
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
