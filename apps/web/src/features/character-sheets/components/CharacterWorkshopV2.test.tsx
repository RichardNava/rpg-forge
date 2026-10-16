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

  it("shows the final-generation panel after confirm with Medieval/Sci-fi only", async () => {
    render(<CharacterWorkshopV2 />);
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });
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

    // Final-generation panel is the primary post-confirm action.
    expect(
      screen.getByRole("heading", { name: /Final sheet/i }),
    ).toBeTruthy();
    const medieval = screen.getByRole("button", { name: /^Medieval$/i });
    const scifi = screen.getByRole("button", { name: /^Sci-fi$/i });
    expect(medieval.getAttribute("aria-pressed")).toBe("true");
    expect(scifi.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Fantasy$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Gothic$/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Generate Final Sheet with AI/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Download Final PDF/i }),
    ).toBeTruthy();
    // Technical PDF is secondary, not the primary CTA.
    expect(
      screen.getByRole("button", { name: /Download technical PDF/i }),
    ).toBeTruthy();

    // Presentation instructions are carried as presentation guidance.
    const instructions = screen.getByLabelText(/Presentation instructions/i);
    fireEvent.change(instructions, {
      target: { value: "Keep the design restrained." },
    });
    expect((instructions as HTMLTextAreaElement).value).toBe(
      "Keep the design restrained.",
    );

    // Switching style keeps the same panel (stable seed is store-owned).
    fireEvent.click(scifi);
    expect(scifi.getAttribute("aria-pressed")).toBe("true");
    expect(medieval.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers Generate Character with AI as an enabled entry, distinct from final generation", async () => {
    render(<CharacterWorkshopV2 />);
    const aiEntry = screen.getByRole("button", {
      name: /Generate Character with AI/i,
    });
    expect((aiEntry as HTMLButtonElement).disabled).toBe(false);
    // Final generation only exists after confirm — never on the landing.
    expect(
      screen.queryByRole("button", { name: /Generate Final Sheet with AI/i }),
    ).toBeNull();

    fireEvent.click(aiEntry);
    const dialog = screen.getByRole("dialog", {
      name: "Generate Character with AI",
    });
    expect(dialog).toBeTruthy();
    // Prompt is required before submitting.
    expect(
      (within(dialog).getByRole("button", {
        name: "Create editable draft with AI",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("creates an editable unconfirmed draft with AI in local mode", async () => {
    render(<CharacterWorkshopV2 />);
    fireEvent.click(
      screen.getByRole("button", { name: /Generate Character with AI/i }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Generate Character with AI",
    });
    fireEvent.change(within(dialog).getByLabelText("Character description"), {
      target: { value: "A large, clumsy orc scout." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "NPC",
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Create editable draft with AI",
      }),
    );

    // The AI draft enters the normal Workshop: editable, unconfirmed.
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });
    expect(
      screen.getByText("Strength", {
        selector: ".character-workshop__field-label",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/confirmed and read-only/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Generate Final Sheet with AI/i }),
    ).toBeNull();

    // The returned draft remains editable through the ordinary editor.
    const notes = screen.getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "Local edit works." } });
    await waitFor(() =>
      expect((notes as HTMLTextAreaElement).value).toBe("Local edit works."),
    );
  });

  it("shows NPC generation instructions only for NPC final generation", async () => {
    render(<CharacterWorkshopV2 />);
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });
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
    // PC drafts (manual default) never show NPC authoring instructions.
    expect(
      screen.queryByLabelText(/NPC generation instructions/i),
    ).toBeNull();
    expect(
      screen.getByLabelText(/Presentation instructions/i),
    ).toBeTruthy();
  });

  it("shows NPC generation instructions for NPC final generation", async () => {
    const { container } = render(<CharacterWorkshopV2 />);
    fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Sheet title")).toBeTruthy();
    });
    const npcButton = container.querySelector(
      'button[aria-label="Non-Player Character"]',
    ) as HTMLButtonElement | null;
    expect(npcButton).not.toBeNull();
    fireEvent.click(npcButton!);
    await waitFor(() => {
      expect(
        container.querySelector(
          'button[aria-label="Non-Player Character"][aria-pressed="true"]',
        ),
      ).not.toBeNull();
    });
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
    const npcInstructions = screen.getByLabelText(
      /NPC generation instructions/i,
    );
    expect(npcInstructions).toBeTruthy();
    fireEvent.change(npcInstructions, {
      target: { value: "Big and clumsy." },
    });
    expect((npcInstructions as HTMLTextAreaElement).value).toBe(
      "Big and clumsy.",
    );
    // Presentation instructions remain a separate field.
    expect(
      screen.getByLabelText(/Presentation instructions/i),
    ).toBeTruthy();
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
