// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkshopPortraitSelector } from "./WorkshopPortraitSelector";

afterEach(cleanup);

function handlers(overrides: Record<string, unknown> = {}) {
  return {
    onUpload: vi.fn(async () => ({ kind: "ok" })),
    onImportUrl: vi.fn(async () => ({ kind: "ok" })),
    onGenerate: vi.fn(async () => ({ kind: "ok" })),
    onSelectNone: vi.fn(),
    ...overrides,
  };
}

function renderSelector(
  overrides: Record<string, unknown> = {},
  handlerOverrides: Record<string, unknown> = {},
) {
  return render(
    <WorkshopPortraitSelector
      hasSlot
      portrait={{ kind: "none" }}
      disabled={false}
      busy={false}
      previewUrl={null}
      previewLoading={false}
      handlers={handlers(handlerOverrides)}
      {...overrides}
    />,
  );
}

describe("WorkshopPortraitSelector", () => {
  it("asks for a slot when the draft has none", () => {
    renderSelector({ hasSlot: false });
    expect(screen.getByText(/Add a Portrait Slot/i)).toBeTruthy();
    expect(screen.queryByText("Portrait source")).toBeNull();
  });

  it("offers exactly None/Upload/URL/AI sources", () => {
    renderSelector();
    expect(screen.getByRole("button", { name: "None" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI" })).toBeTruthy();
  });

  it("selecting None calls onSelectNone", () => {
    const onSelectNone = vi.fn();
    renderSelector(
      { portrait: { kind: "upload", assetId: "asset-1" } },
      { onSelectNone },
    );
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onSelectNone).toHaveBeenCalledTimes(1);
  });

  it("upload sends the picked file and keeps prior config on failure", async () => {
    const onUpload = vi.fn(async () => ({ kind: "error" }));
    renderSelector({}, { onUpload });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = screen.getByLabelText("Portrait image file") as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50])], "art.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(/portrait upload failed/i);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("URL import sends the trimmed URL only on success path", async () => {
    const onImportUrl = vi.fn(async () => ({ kind: "ok" }));
    renderSelector({}, { onImportUrl });
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    fireEvent.change(screen.getByLabelText(/Image URL/i), {
      target: { value: "https://example.com/a.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
    expect(onImportUrl).toHaveBeenCalledWith("https://example.com/a.png");
  });

  it("AI generation sends the trimmed prompt", async () => {
    const onGenerate = vi.fn(async () => ({ kind: "ok" }));
    renderSelector({}, { onGenerate });
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    fireEvent.change(screen.getByLabelText(/Portrait description/i), {
      target: { value: "a scarred ranger" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate portrait" }));
    expect(onGenerate).toHaveBeenCalledWith("a scarred ranger");
  });

  it("shows the active source without re-offering its form", () => {
    renderSelector({ portrait: { kind: "ai", assetId: "asset-9" } });
    expect(screen.getByText(/Active source: AI/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Portrait description/i)).toBeNull();
  });

  it("renders the protected preview image with contain fit", () => {
    renderSelector({
      portrait: { kind: "upload", assetId: "asset-1" },
      previewUrl: "blob:preview-1",
    });
    const image = screen.getByAltText("Portrait preview") as HTMLImageElement;
    expect(image.src).toContain("blob:preview-1");
    expect(image.style.objectFit).toBe("contain");
  });

  it("shows an empty placeholder when no portrait is configured", () => {
    renderSelector();
    expect(screen.getByLabelText("Empty portrait frame")).toBeTruthy();
  });
});
