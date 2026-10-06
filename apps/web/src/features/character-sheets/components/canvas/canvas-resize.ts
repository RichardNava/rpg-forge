import type { DraftLayoutNodeV1 } from "@repo/character-sheet-draft";

/**
 * Grid-snapping math for direct-manipulation resize (14.9).
 *
 * All functions are pure: pointer deltas in, validated integer spans out.
 * The Canvas keeps transient preview geometry in local component state during
 * a gesture and commits exactly one `set_node_layout` on pointer-up; these
 * helpers own the snapping so JSX never does arithmetic.
 */

export interface ResizeBounds {
  /** Maximum column span from the fixed start (parent columns - start + 1). */
  maxColumnSpan: number;
  /** Maximum row span (domain bound, 12). */
  maxRowSpan: number;
}

/**
 * Snaps a horizontal pointer delta to a column span.
 *
 * @param startSpan span when the gesture began
 * @param deltaPx horizontal pointer travel in CSS pixels
 * @param pxPerColumn measured width of one parent grid column
 * @param maxSpan largest span allowed from the fixed start
 */
export function snapColumnSpan(
  startSpan: number,
  deltaPx: number,
  pxPerColumn: number,
  maxSpan: number,
): number {
  if (!(pxPerColumn > 0)) {
    return startSpan;
  }
  const stepped = startSpan + Math.round(deltaPx / pxPerColumn);
  return Math.min(Math.max(stepped, 1), Math.max(1, maxSpan));
}

/**
 * Snaps a vertical pointer delta to a row span against the Canvas row unit.
 */
export function snapRowSpan(
  startSpan: number,
  deltaPx: number,
  rowUnitPx: number,
  maxSpan: number,
): number {
  if (!(rowUnitPx > 0)) {
    return startSpan;
  }
  const stepped = startSpan + Math.round(deltaPx / rowUnitPx);
  return Math.min(Math.max(stepped, 1), Math.max(1, maxSpan));
}

/**
 * Applies one resize step to a node geometry, leaving columnStart and
 * breakBefore untouched (resize modifies spans only, never position).
 */
export function applyResizePreview(
  geometry: DraftLayoutNodeV1,
  next: { columnSpan?: number; rowSpan?: number },
): DraftLayoutNodeV1 {
  return {
    ...geometry,
    columnSpan: next.columnSpan ?? geometry.columnSpan,
    rowSpan: next.rowSpan ?? geometry.rowSpan,
  };
}
