// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadSheetDialog } from "./UploadSheetDialog";

afterEach(cleanup);

describe("UploadSheetDialog", () => {
  it("includes a user-selected start page for a long PDF", async () => {
    const onSubmit = vi.fn(async () => null);
    render(
      <UploadSheetDialog
        open
        busy={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Upload an existing sheet",
    });
    const pdf = new File(["sheet"], "adventurer.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(dialog).getByLabelText("Sheet document"), {
      target: { files: [pdf] },
    });

    fireEvent.click(
      within(dialog).getByLabelText("This PDF has more than 3 pages"),
    );
    fireEvent.change(
      within(dialog).getByLabelText("Start extracting at page"),
      { target: { value: "2" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Extract fields" }),
    );

    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "adventurer.pdf",
        sheetStartPage: 2,
      }),
    );
  });
});
