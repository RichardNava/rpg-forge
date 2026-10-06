import { useEffect, useRef } from "react";
import type { DraftLayoutNodeV1 } from "@repo/character-sheet-draft";
import {
  applyResizePreview,
  snapColumnSpan,
  snapRowSpan,
} from "./canvas-resize";

/**
 * Direct-manipulation resize handles for one Canvas node (14.9).
 *
 * - East handle resizes column span, south handle row span, southeast corner
 *   resizes both. Handles render only on the selected node.
 * - Mouse gestures preview locally (parent-owned preview state) and commit
 *   exactly one `set_node_layout` on mouse-up; Escape or mouse-cancel
 *   discards the preview and restores authoritative geometry.
 * - East/south handles are also keyboard sliders (arrows commit one step,
 *   Home/End jump); the corner is pointer-only and hidden from assistive
 *   tech because the sliders plus the inspector numerics cover it.
 * - No store writes happen during the gesture: pointer movement updates
 *   preview state in the owning node component alone, so the rest of the
 *   tree never rerenders.
 * - Mouse (not pointer) events drive the gesture: TouchSensor covers touch
 *   drag input for DnD; resize targets mouse/trackpad here.
 */

interface ResizeHandlesProps {
  label: string;
  geometry: DraftLayoutNodeV1;
  /** Preview geometry while gesturing, or null when idle. */
  preview: DraftLayoutNodeV1 | null;
  /** Container columns of the node's current parent. */
  parentColumns: number;
  onPreview(geometry: DraftLayoutNodeV1 | null): void;
  onCommit(geometry: DraftLayoutNodeV1): void;
}

type HandleKind = "east" | "south" | "southeast";

interface Gesture {
  kind: HandleKind;
  startX: number;
  startY: number;
  pxPerColumn: number;
  rowUnitPx: number;
  start: DraftLayoutNodeV1;
}

const MAX_ROW_SPAN = 12;

export function CanvasResizeHandles({
  label,
  geometry,
  preview,
  parentColumns,
  onPreview,
  onCommit,
}: ResizeHandlesProps) {
  const gesture = useRef<Gesture | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({
    geometry,
    preview,
    parentColumns,
    onPreview,
    onCommit,
  });
  useEffect(() => {
    latest.current = { geometry, preview, parentColumns, onPreview, onCommit };
  });

  useEffect(
    () => () => {
      gesture.current = null;
      cleanup.current?.();
      cleanup.current = null;
    },
    [],
  );

  function detachWindowListeners() {
    cleanup.current?.();
    cleanup.current = null;
  }

  function maxSpan(columns: number, start: number): number {
    return Math.max(1, columns - start + 1);
  }

  function beginGesture(
    kind: HandleKind,
    event: React.MouseEvent<HTMLElement>,
  ) {
    if (event.button !== 0) {
      return;
    }
    const card = (event.currentTarget as HTMLElement).closest(
      "[data-canvas-node]",
    );
    const rect = card?.getBoundingClientRect();
    const current = latest.current;
    gesture.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      pxPerColumn:
        rect !== undefined && current.geometry.columnSpan > 0
          ? rect.width / current.geometry.columnSpan
          : 0,
      rowUnitPx:
        rect !== undefined && current.geometry.rowSpan > 0
          ? rect.height / current.geometry.rowSpan
          : 0,
      start: current.geometry,
    };
    event.currentTarget.focus({ preventScroll: true });
    const finishGesture = (commit: boolean) => {
      const active = gesture.current;
      gesture.current = null;
      detachWindowListeners();
      const live = latest.current;
      if (commit && active !== null && live.preview !== null) {
        live.onCommit(live.preview);
      } else {
        live.onPreview(null);
      }
    };
    const handleUp = () => finishGesture(true);
    const handleMove = (moveEvent: MouseEvent) => {
      const active = gesture.current;
      if (active === null) {
        return;
      }
      const live = latest.current;
      const next = { ...active.start };
      if (active.kind === "east" || active.kind === "southeast") {
        next.columnSpan = snapColumnSpan(
          active.start.columnSpan,
          moveEvent.clientX - active.startX,
          active.pxPerColumn,
          maxSpan(live.parentColumns, active.start.columnStart),
        );
      }
      if (active.kind === "south" || active.kind === "southeast") {
        next.rowSpan = snapRowSpan(
          active.start.rowSpan,
          moveEvent.clientY - active.startY,
          active.rowUnitPx,
          MAX_ROW_SPAN,
        );
      }
      live.onPreview(next);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
    cleanup.current = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }

  function cancelGesture() {
    gesture.current = null;
    detachWindowListeners();
    latest.current.onPreview(null);
  }

  function handleKey(
    axis: "columnSpan" | "rowSpan",
    event: React.KeyboardEvent<HTMLElement>,
  ) {
    if (gesture.current !== null) {
      // A pointer gesture owns the interaction: only Escape may interrupt.
      if (event.key === "Escape") {
        event.preventDefault();
        cancelGesture();
      }
      return;
    }
    const maximum =
      axis === "columnSpan"
        ? maxSpan(parentColumns, geometry.columnStart)
        : MAX_ROW_SPAN;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = Math.min(geometry[axis] + 1, maximum);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = Math.max(geometry[axis] - 1, 1);
    } else if (event.key === "Home") {
      next = 1;
    } else if (event.key === "End") {
      next = maximum;
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (next !== geometry[axis]) {
      onCommit(applyResizePreview(geometry, { [axis]: next }));
    }
  }

  const shown = preview ?? geometry;

  return (
    <>
      <div
        role="slider"
        tabIndex={0}
        className="canvas-resize canvas-resize--east"
        aria-label={`Width of ${label}`}
        aria-valuemin={1}
        aria-valuemax={maxSpan(parentColumns, geometry.columnStart)}
        aria-valuenow={shown.columnSpan}
        aria-valuetext={`${shown.columnSpan} columns`}
        onMouseDown={(event) => beginGesture("east", event)}
        onKeyDown={(event) => handleKey("columnSpan", event)}
      />
      <div
        role="slider"
        tabIndex={0}
        className="canvas-resize canvas-resize--south"
        aria-label={`Height of ${label}`}
        aria-valuemin={1}
        aria-valuemax={MAX_ROW_SPAN}
        aria-valuenow={shown.rowSpan}
        aria-valuetext={`${shown.rowSpan} rows`}
        onMouseDown={(event) => beginGesture("south", event)}
        onKeyDown={(event) => handleKey("rowSpan", event)}
      />
      <div
        aria-hidden="true"
        className="canvas-resize canvas-resize--southeast"
        onMouseDown={(event) => beginGesture("southeast", event)}
      />
    </>
  );
}
