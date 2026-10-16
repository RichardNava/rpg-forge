// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerateAiDraftDialog } from "./GenerateAiDraftDialog";

afterEach(() => {
  cleanup();
});

function renderDialog(
  overrides: Partial<Parameters<typeof GenerateAiDraftDialog>[0]> = {},
) {
  const props = {
    open: true,
    mode: "pc" as const,
    prompt: "",
    busy: false,
    error: null as string | null,
    onModeChange: vi.fn(),
    onPromptChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<GenerateAiDraftDialog {...props} />);
  return props;
}

describe("GenerateAiDraftDialog", () => {
  it("renders closed as null and stays distinct from final generation", () => {
    const { container } = render(
      <GenerateAiDraftDialog
        open={false}
        mode="pc"
        prompt=""
        busy={false}
        error={null}
        onModeChange={vi.fn()}
        onPromptChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
    renderDialog();
    expect(
      screen.getByRole("dialog", { name: "Generate Character with AI" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Generate Final Sheet with AI/i)).toBeNull();
    expect(
      screen.getByText(/starting draft that you can fully edit/i),
    ).toBeTruthy();
  });

  it("selects PC/NPC and requires a prompt before submitting", () => {
    const props = renderDialog();
    const pc = screen.getByRole("button", { name: "PC" });
    const npc = screen.getByRole("button", { name: "NPC" });
    expect(pc.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(npc);
    expect(props.onModeChange).toHaveBeenCalledWith("npc");

    const submit = screen.getByRole("button", {
      name: "Create editable draft with AI",
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    const filled = renderDialog({ prompt: "A large orc." });
    const submit2 = screen.getByRole("button", {
      name: "Create editable draft with AI",
    });
    expect((submit2 as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit2);
    expect(filled.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows busy status and errors", () => {
    renderDialog({ busy: true, prompt: "A scout." });
    expect(screen.getByRole("status")).toBeTruthy();
    cleanup();
    renderDialog({ error: "The AI draft could not be created." });
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
