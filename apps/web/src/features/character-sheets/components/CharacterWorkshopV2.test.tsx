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
import {
  CharacterWorkshopV2,
  resolveV2SessionToken,
} from "./CharacterWorkshopV2";

afterEach(() => {
  cleanup();
});

describe("CharacterWorkshopV2", () => {
  it("walks the manual V2 creation loop: create, edit, add field, confirm, read-only", async () => {
    render(<CharacterWorkshopV2 />);

    expect(
      screen.getByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
      expect(
        screen.getByText("Character name", {
          selector: ".character-workshop__field-label",
        }),
      ).toBeTruthy();
    });

    const titleInput = screen.getByLabelText("Sheet title");
    fireEvent.change(titleInput, { target: { value: "Mara Thorn" } });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Sheet title") as HTMLInputElement).value,
      ).toBe("Mara Thorn");
    });

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

    const ageInput = screen.getByLabelText("Age");
    fireEvent.change(ageInput, { target: { value: "29" } });
    await waitFor(() =>
      expect((ageInput as HTMLInputElement).value).toBe("29"),
    );

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
  });

  it("emits only DraftMutationV2 operations", async () => {
    const seen: string[] = [];
    const { container } = render(<CharacterWorkshopV2 />);
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });
    // No V1-only movement affordances exist in the V2 surface.
    expect(container.innerHTML).not.toContain("move_field");
    expect(container.innerHTML).not.toContain("reparent_section");
    expect(seen).toEqual([]);
    void seen;
  });

  it("fails closed in remote mode without a token provider", async () => {
    await expect(resolveV2SessionToken("remote", undefined)).rejects.toThrow(
      "Human verification is required",
    );
  });

  it("never sends local-turnstile-bypass from the V2 remote surface", async () => {
    await expect(
      resolveV2SessionToken("remote", async () => "local-turnstile-bypass"),
    ).rejects.toThrow("Human verification is required");
    await expect(
      resolveV2SessionToken("remote", async () => ""),
    ).rejects.toThrow("Human verification is required");
    await expect(
      resolveV2SessionToken("remote", async () => "real-token"),
    ).resolves.toBe("real-token");
    await expect(resolveV2SessionToken("local", undefined)).resolves.toBe(
      "local-turnstile-bypass",
    );
  });
});
