// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createBlankDraftV2 } from "../lib/dev-fixture-v2";
import { downloadConfirmedDraftPdfV2 } from "./export-confirmed-draft-pdf-v2";

describe("downloadConfirmedDraftPdfV2", () => {
  it("refuses an unconfirmed V2 draft without rendering", async () => {
    const draft = createBlankDraftV2("session.export-v2");
    await expect(downloadConfirmedDraftPdfV2(draft)).rejects.toThrow(
      "Confirm the sheet before downloading it.",
    );
  });

  it("renders a confirmed V2 draft through the V2 projection", async () => {
    const draft = {
      ...createBlankDraftV2("session.export-v2"),
      confirmed: true,
    };
    const createObjectURL = vi.fn(() => "blob:pdf");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement");
    createElement.mockImplementationOnce(
      () => ({ click, href: "", download: "" }) as unknown as HTMLElement,
    );

    await downloadConfirmedDraftPdfV2(draft);

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
    vi.unstubAllGlobals();
    createElement.mockRestore();
  });
});
