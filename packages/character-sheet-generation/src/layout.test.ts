import { describe, expect, it } from "vitest";
import {
  compileTheme,
  computeFieldPlacements,
  computeSectionColumns,
  intrinsicHeightHint,
  packSectionPages,
} from "./layout.js";

describe("compileTheme", () => {
  it("maps player and npc modes to fixed themes", () => {
    expect(compileTheme("player").style).toBe("classic");
    expect(compileTheme("player").backgroundIntent).toBe("parchment");
    expect(compileTheme("npc").style).toBe("utility");
    expect(compileTheme("npc").density).toBe("compact");
  });
});

describe("computeSectionColumns", () => {
  it("picks a deterministic column count from the field count", () => {
    expect(computeSectionColumns(1)).toBe(1);
    expect(computeSectionColumns(2)).toBe(2);
    expect(computeSectionColumns(4)).toBe(2);
    expect(computeSectionColumns(5)).toBe(3);
    expect(computeSectionColumns(10)).toBe(4);
  });
});

describe("computeFieldPlacements", () => {
  it("places fields greedily across rows and honors breakBefore", () => {
    const placements = computeFieldPlacements(
      2,
      [1, 1, 2, 1],
      [false, false, true, false],
    );
    expect(placements).toEqual([
      { columnStart: 1, columnSpan: 1, rowSpan: 1, breakBefore: false },
      { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
      { columnStart: 1, columnSpan: 1, rowSpan: 2, breakBefore: true },
      { columnStart: 2, columnSpan: 1, rowSpan: 1, breakBefore: false },
    ]);
  });

  it("resets to the first column after the last slot", () => {
    const placements = computeFieldPlacements(1, [1, 1], [false, false]);
    expect(placements.map((placement) => placement.columnStart)).toEqual([
      1, 1,
    ]);
  });
});

describe("intrinsicHeightHint", () => {
  it("returns fixed heights for images and tables", () => {
    expect(intrinsicHeightHint("image", {})).toBe(2);
    expect(intrinsicHeightHint("table", { maxRows: 4 })).toBe(2);
  });

  it("scales tall textareas and long lists", () => {
    expect(intrinsicHeightHint("textarea", { rows: 8 })).toBe(2);
    expect(intrinsicHeightHint("textarea", { rows: 3 })).toBe(1);
    expect(intrinsicHeightHint("list", { maxItems: 12 })).toBe(2);
    expect(intrinsicHeightHint("text", {})).toBe(1);
  });
});

describe("packSectionPages", () => {
  it("packs sections within row and count caps", () => {
    const pages = packSectionPages(
      [
        { key: "a", rowCost: 8 },
        { key: "b", rowCost: 8 },
        { key: "c", rowCost: 8 },
        { key: "d", rowCost: 8 },
      ],
      { pageRowCap: 10, maxPages: 4, maxSectionsPerPage: 16 },
    );
    expect(pages).toHaveLength(4);
    expect(pages[0]?.sectionIds).toEqual(["a"]);
  });

  it("widens the row cap deterministically to honor maxPages", () => {
    const pages = packSectionPages(
      [
        { key: "a", rowCost: 4 },
        { key: "b", rowCost: 4 },
        { key: "c", rowCost: 4 },
        { key: "d", rowCost: 4 },
        { key: "e", rowCost: 4 },
        { key: "f", rowCost: 4 },
      ],
      { pageRowCap: 4, maxPages: 2, maxSectionsPerPage: 16 },
    );
    expect(pages.length).toBe(2);
    expect(pages[0]?.sectionIds).toEqual(["a", "b", "c"]);
    expect(pages[1]?.sectionIds).toEqual(["d", "e", "f"]);
  });
});
