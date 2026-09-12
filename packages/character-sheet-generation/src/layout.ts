import type { ThemeSpec } from "@repo/character-sheet-schema";
import type { CharacterSheetMode } from "@repo/character-sheet-schema";

/**
 * Deterministic theme mapping. Sheet mode is the only input; every value is
 * fixed in code so the same rules context always compiles to the same look.
 */
export function compileTheme(mode: CharacterSheetMode): ThemeSpec {
  if (mode === "npc") {
    return {
      style: "utility",
      typography: "sans-serif",
      density: "compact",
      borderStyle: "line",
      decorationIntensity: "none",
      accentColor: "#4a6fa5",
      backgroundIntent: "light",
    };
  }
  return {
    style: "classic",
    typography: "serif",
    density: "standard",
    borderStyle: "line",
    decorationIntensity: "subtle",
    accentColor: "#7a4e2d",
    backgroundIntent: "parchment",
  };
}

export interface SectionLayoutPlan {
  columns: number;
  order: number;
  emphasis: "normal" | "primary" | "secondary" | null;
}

export function computeSectionColumns(fieldCount: number): number {
  if (fieldCount <= 1) {
    return 1;
  }
  if (fieldCount <= 4) {
    return 2;
  }
  if (fieldCount <= 9) {
    return 3;
  }
  return 4;
}

/**
 * Deterministic placement pass. Fields fill columns greedily in declaration
 * order; `breakBefore` forces a fresh row; rowSpan encodes intrinsic field
 * height so tables, images and tall textareas reserve vertical space.
 */
export interface FieldPlacementPlan {
  columnStart: number;
  columnSpan: number;
  rowSpan: number;
  breakBefore: boolean;
}

export function computeFieldPlacements(
  columns: number,
  candidateHeights: readonly number[],
  candidatesBreakBefore: readonly boolean[],
): readonly FieldPlacementPlan[] {
  const placements: FieldPlacementPlan[] = [];
  let nextColumn = 0;
  let rowSpanAccumulator = 1;

  for (let index = 0; index < candidateHeights.length; index += 1) {
    if (candidatesBreakBefore[index] ?? false) {
      nextColumn = 0;
    }
    if (nextColumn !== 0) {
      rowSpanAccumulator = 1;
    }
    const rowSpan = candidateHeights[index] ?? 1;
    rowSpanAccumulator = Math.max(rowSpanAccumulator, rowSpan);
    placements.push({
      columnStart: nextColumn + 1,
      columnSpan: 1,
      rowSpan,
      breakBefore: candidatesBreakBefore[index] ?? false,
    });
    nextColumn = (nextColumn + 1) % columns;
  }

  return placements;
}

export function intrinsicHeightHint(
  type: string,
  details: {
    rows?: number;
    maxItems?: number;
    maxRows?: number;
  },
): number {
  switch (type) {
    case "image":
    case "table":
      return 2;
    case "textarea":
      return (details.rows ?? 4) >= 6 ? 2 : 1;
    case "list":
      return (details.maxItems ?? 8) > 10 ? 2 : 1;
    default:
      return 1;
  }
}

export interface CompiledPagePlan {
  id: string;
  sectionIds: string[];
}

/**
 * Deterministic page packing: sections fill pages in canonical order up to a
 * row budget, capped at the canonical sections-per-page and page bounds. If the
 * natural budget would exceed the maximum pages, the cap is widened
 * deterministically to fit within the canonical maximum.
 */
export function packSectionPages(
  sections: readonly {
    key: string;
    rowCost: number;
  }[],
  options: {
    pageRowCap: number;
    maxPages: number;
    maxSectionsPerPage: number;
  },
): readonly CompiledPagePlan[] {
  const maxPageRowCap = Math.max(
    options.pageRowCap,
    Math.ceil(
      sections.reduce((sum, section) => sum + section.rowCost, 0) /
        options.maxPages,
    ),
  );

  const pages: CompiledPagePlan[] = [];
  let current: CompiledPagePlan = { id: "page-1", sectionIds: [] };
  let currentRows = 0;
  let currentSections = 0;

  for (const section of sections) {
    const wouldExceedRows = currentRows + section.rowCost > maxPageRowCap;
    const wouldExceedCap = currentSections + 1 > options.maxSectionsPerPage;
    if ((wouldExceedRows || wouldExceedCap) && current.sectionIds.length > 0) {
      pages.push(current);
      current = {
        id: `page-${pages.length + 1}`,
        sectionIds: [],
      };
      currentRows = 0;
      currentSections = 0;
    }
    current.sectionIds.push(section.key);
    currentRows += section.rowCost;
    currentSections += 1;
  }
  if (current.sectionIds.length > 0) {
    pages.push(current);
  }

  return pages;
}
