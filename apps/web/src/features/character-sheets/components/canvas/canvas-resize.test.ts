import { describe, expect, it } from "vitest";
import {
  applyResizePreview,
  snapColumnSpan,
  snapRowSpan,
} from "./canvas-resize";

const GEOMETRY = {
  columnStart: 1,
  columnSpan: 1,
  rowSpan: 1,
  breakBefore: false,
};

describe("snapColumnSpan", () => {
  it("snaps pointer travel to whole columns", () => {
    expect(snapColumnSpan(1, 0, 100, 4)).toBe(1);
    expect(snapColumnSpan(1, 60, 100, 4)).toBe(2);
    expect(snapColumnSpan(1, -60, 100, 4)).toBe(1);
    expect(snapColumnSpan(2, 149, 100, 4)).toBe(3);
  });

  it("clamps to the valid span range", () => {
    expect(snapColumnSpan(1, 10000, 100, 4)).toBe(4);
    expect(snapColumnSpan(3, -10000, 100, 4)).toBe(1);
    expect(snapColumnSpan(1, 10000, 100, 1)).toBe(1);
  });

  it("holds the start span for degenerate measurements", () => {
    expect(snapColumnSpan(2, 500, 0, 4)).toBe(2);
    expect(snapColumnSpan(2, 500, -10, 4)).toBe(2);
  });
});

describe("snapRowSpan", () => {
  it("snaps pointer travel to whole rows", () => {
    expect(snapRowSpan(1, 0, 48, 12)).toBe(1);
    expect(snapRowSpan(1, 30, 48, 12)).toBe(2);
    expect(snapRowSpan(2, -30, 48, 12)).toBe(1);
  });

  it("clamps to 1..max", () => {
    expect(snapRowSpan(1, 100000, 48, 12)).toBe(12);
    expect(snapRowSpan(5, -100000, 48, 12)).toBe(1);
  });
});

describe("applyResizePreview", () => {
  it("changes spans without touching start or break", () => {
    expect(applyResizePreview(GEOMETRY, { columnSpan: 3, rowSpan: 2 })).toEqual(
      {
        columnStart: 1,
        columnSpan: 3,
        rowSpan: 2,
        breakBefore: false,
      },
    );
  });

  it("leaves untouched axes intact", () => {
    expect(applyResizePreview(GEOMETRY, {})).toEqual(GEOMETRY);
    expect(applyResizePreview(GEOMETRY, { rowSpan: 4 }).columnSpan).toBe(1);
  });
});
