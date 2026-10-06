import { useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type {
  CharacterSheetDraftV2,
  DraftLayoutNodeV1,
  DraftReadNodeV2,
} from "@repo/character-sheet-draft";
import { DEFAULT_DRAFT_NODE_LAYOUT_V1 } from "@repo/character-sheet-draft";
import {
  dropIntentId,
  type CanvasDropIntent,
  type CanvasNodeKind,
} from "./canvas-dnd";
import { CanvasResizeHandles } from "./canvas-resize-handles";
import { FieldValueInput } from "./field-editing";
import {
  gridContainerStyle,
  gridItemStyle,
  type SpatialSurface,
} from "./spatial-surface";
import type { SheetCanvasCallbacks } from "./SheetCanvasV2";
import type { CanvasSelection } from "./canvas-types";

export interface CanvasNodeFrame {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
  selected: boolean;
  invalidIntents: ReadonlySet<string>;
  dragActive: boolean;
  onSelect(selection: CanvasSelection): void;
  onOpenKeyboardMove(entry: {
    kind: CanvasNodeKind;
    key: string;
    label: string;
  }): void;
  onResizeActive(key: string | null): void;
}

/**
 * Insertion rail for one before/after intent. Presentation-only for sighted
 * users (aria-hidden); intent semantics travel through droppable data into
 * announcements, and geometry addressing uses data-dnd-intent.
 */
export function IntentRail({
  intent,
  targetKey,
  targetLabel,
  parentLabel,
  invalid,
  active,
}: {
  intent: Extract<CanvasDropIntent, { kind: "before" | "after" }>;
  targetKey: string;
  targetLabel: string;
  parentLabel: string;
  invalid: boolean;
  active: boolean;
}) {
  const id = dropIntentId(intent);
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { targetKey, targetLabel, parentLabel },
  });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-dnd-intent={id}
      className={
        isOver
          ? invalid
            ? "canvas-rail canvas-rail--over-invalid"
            : "canvas-rail canvas-rail--over-valid"
          : invalid && active
            ? "canvas-rail canvas-rail--invalid"
            : "canvas-rail"
      }
    />
  );
}

function parentColumnsOf(
  surface: SpatialSurface,
  parentKey: string | null,
): number {
  if (parentKey === null) {
    return surface.layout.root.columns;
  }
  return surface.layout.sections[parentKey]?.columns ?? 1;
}

export function CanvasFieldNode({
  draft,
  surface,
  node,
  callbacks,
  disabled,
  selected,
  invalidIntents,
  dragActive,
  onSelect,
  onOpenKeyboardMove,
  onResizeActive,
}: CanvasNodeFrame & { node: Extract<DraftReadNodeV2, { kind: "field" }> }) {
  const field = node.field;
  const stored = surface.layout.nodes[field.key] ?? {
    ...DEFAULT_DRAFT_NODE_LAYOUT_V1,
  };
  const [preview, setPreview] = useState<DraftLayoutNodeV1 | null>(null);
  const geometry = preview ?? stored;
  const value = draft.values[field.key] ?? null;
  const readOnly = disabled || field.locked;

  const draggable = useDraggable({
    id: `field:${field.key}`,
    disabled,
    data: { kind: "field", key: field.key, label: field.label },
  });

  const parentLabel =
    node.parentKey === null
      ? ""
      : (draft.sections.find((entry) => entry.key === node.parentKey)?.title ??
        node.parentKey);

  // Filter draggable attributes for the card node: keep listeners but remove
  // role="button" etc. which belong on the activator (the handle), not the
  // draggable node itself when using a separate activator.
  const cardAttributes: Record<string, unknown> = { ...draggable.attributes };
  delete cardAttributes.role;
  delete cardAttributes["aria-roledescription"];
  delete cardAttributes.tabIndex;

  return (
    <div style={gridItemStyle(geometry)}>
      {!disabled && (
        <IntentRail
          intent={{ kind: "before", targetKind: "field", key: field.key }}
          targetKey={field.key}
          targetLabel={field.label}
          parentLabel={parentLabel}
          invalid={invalidIntents.has(
            dropIntentId({
              kind: "before",
              targetKind: "field",
              key: field.key,
            }),
          )}
          active={dragActive}
        />
      )}
      <div
        // eslint-disable-next-line react-hooks/refs
        ref={draggable.setNodeRef}
        data-canvas-node={field.key}
        data-canvas-selected={selected}
        className={
          selected
            ? "character-workshop__field-card canvas-card canvas-card--selected"
            : "character-workshop__field-card canvas-card"
        }
        style={gridItemStyle(geometry)}
        // eslint-disable-next-line react-hooks/refs
        {...draggable.listeners}
        {...cardAttributes}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ kind: "field", key: field.key });
        }}
      >
        {!disabled && (
          <button
            type="button"
            className="character-workshop__drag-handle"
            aria-label={`Move ${field.label}`}
            data-canvas-handle={field.key}
            // eslint-disable-next-line react-hooks/refs
            ref={draggable.setActivatorNodeRef}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                onOpenKeyboardMove({
                  kind: "field",
                  key: field.key,
                  label: field.label,
                });
              }
            }}
          >
            Move
          </button>
        )}
        <span className="character-workshop__field-label">{field.label}</span>
        <FieldValueInput
          field={field}
          value={value}
          readOnly={readOnly}
          onSetValue={(next) => callbacks.onSetValue(field.key, next)}
          onClearValue={() => callbacks.onClearValue(field.key)}
        />
        {selected && !disabled && (
          <CanvasResizeHandles
            label={field.label}
            geometry={stored}
            preview={preview}
            parentColumns={parentColumnsOf(surface, node.parentKey)}
            onPreview={(next) => {
              setPreview(next);
              onResizeActive(next === null ? null : field.key);
            }}
            onCommit={(next) => {
              setPreview(null);
              onResizeActive(null);
              callbacks.onSetNodeLayout(field.key, next);
            }}
          />
        )}
      </div>
      {!disabled && (
        <IntentRail
          intent={{ kind: "after", targetKind: "field", key: field.key }}
          targetKey={field.key}
          targetLabel={field.label}
          parentLabel={parentLabel}
          invalid={invalidIntents.has(
            dropIntentId({
              kind: "after",
              targetKind: "field",
              key: field.key,
            }),
          )}
          active={dragActive}
        />
      )}
    </div>
  );
}

export function CanvasSectionNode({
  draft,
  surface,
  node,
  callbacks,
  disabled,
  selected,
  invalidIntents,
  dragActive,
  onSelect,
  onOpenKeyboardMove,
  onResizeActive,
  children,
}: CanvasNodeFrame & {
  node: Extract<DraftReadNodeV2, { kind: "section" }>;
  children: ReactNode;
}) {
  const stored = surface.layout.nodes[node.key] ?? {
    ...DEFAULT_DRAFT_NODE_LAYOUT_V1,
  };
  const [preview, setPreview] = useState<DraftLayoutNodeV1 | null>(null);
  const geometry = preview ?? stored;
  const containerColumns = surface.layout.sections[node.key]?.columns ?? 1;

  const draggable = useDraggable({
    id: `section:${node.key}`,
    disabled,
    data: { kind: "section", key: node.key, label: node.section.title },
  });
  const insideId = dropIntentId({ kind: "inside", sectionKey: node.key });
  // Droppable lives on the section BODY (the canvas-scroll container), not the
  // whole section wrapper, so its rect matches the visual drop zone.
  const bodyDroppable = useDroppable({
    id: insideId,
    data: {
      targetKey: node.key,
      targetLabel: node.section.title,
      parentLabel: "",
    },
  });

  const parentLabel =
    node.parentKey === null
      ? ""
      : (draft.sections.find((entry) => entry.key === node.parentKey)?.title ??
        node.parentKey);
  const childCount = surface.readModel.childrenByParent.get(node.key) ?? [];

  // Filter draggable attributes for the section node (same reasoning as field cards).
  const sectionAttributes: Record<string, unknown> = {
    ...draggable.attributes,
  };
  delete sectionAttributes.role;
  delete sectionAttributes["aria-roledescription"];
  delete sectionAttributes.tabIndex;

  return (
    <div style={gridItemStyle(geometry)}>
      {!disabled && (
        <IntentRail
          intent={{ kind: "before", targetKind: "section", key: node.key }}
          targetKey={node.key}
          targetLabel={node.section.title}
          parentLabel={parentLabel}
          invalid={invalidIntents.has(
            dropIntentId({
              kind: "before",
              targetKind: "section",
              key: node.key,
            }),
          )}
          active={dragActive}
        />
      )}
      <section
        // eslint-disable-next-line react-hooks/refs
        ref={draggable.setNodeRef}
        data-canvas-node={node.key}
        data-canvas-selected={selected}
        className={
          selected
            ? "character-workshop__field-group canvas-section canvas-section--selected"
            : "character-workshop__field-group canvas-section"
        }
        data-depth={node.depth}
        aria-labelledby={`canvas-section-${node.key}`}
        style={gridItemStyle(geometry)}
        // eslint-disable-next-line react-hooks/refs
        {...draggable.listeners}
        {...sectionAttributes}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ kind: "section", key: node.key });
        }}
      >
        <div
          className="character-workshop__section-wrapper"
          style={{ height: "100%", display: "flex", flexDirection: "column" }}
        >
          <div className="character-workshop__section-heading">
            <h3
              id={`canvas-section-${node.key}`}
              className="character-workshop__field-group-title"
            >
              {node.section.title}
            </h3>
            {!disabled && (
              <button
                type="button"
                className="character-workshop__drag-handle"
                aria-label={`Move ${node.section.title}`}
                data-canvas-handle={node.key}
                // eslint-disable-next-line react-hooks/refs
                ref={draggable.setActivatorNodeRef}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    onOpenKeyboardMove({
                      kind: "section",
                      key: node.key,
                      label: node.section.title,
                    });
                  }
                }}
              >
                Move
              </button>
            )}
          </div>
          <div
            className="character-workshop__canvas-scroll"
            // eslint-disable-next-line react-hooks/refs
            ref={bodyDroppable.setNodeRef}
            data-dnd-intent={disabled ? undefined : insideId}
          >
            <div
              className={
                // eslint-disable-next-line react-hooks/refs
                bodyDroppable.isOver
                  ? invalidIntents.has(insideId)
                    ? "canvas-section-body canvas-section-body--over-invalid"
                    : "canvas-section-body canvas-section-body--over-valid"
                  : invalidIntents.has(insideId) && dragActive
                    ? "canvas-section-body canvas-section-body--invalid"
                    : selected
                      ? "canvas-section-body canvas-grid canvas-grid--active"
                      : "canvas-section-body canvas-grid"
              }
              style={{
                ...gridContainerStyle(containerColumns),
                ["--canvas-cols" as string]: containerColumns,
                minWidth:
                  containerColumns > 2
                    ? `${containerColumns * 9}rem`
                    : undefined,
              }}
            >
              {children}
              {childCount.length === 0 && (
                <p className="canvas-empty-hint">
                  Drop fields or sections here
                </p>
              )}
            </div>
          </div>
          {selected && !disabled && (
            <CanvasResizeHandles
              label={node.section.title}
              geometry={stored}
              preview={preview}
              parentColumns={parentColumnsOf(surface, node.parentKey)}
              onPreview={(next) => {
                setPreview(next);
                onResizeActive(next === null ? null : node.key);
              }}
              onCommit={(next) => {
                setPreview(null);
                onResizeActive(null);
                callbacks.onSetNodeLayout(node.key, next);
              }}
            />
          )}
        </div>
      </section>
      {!disabled && (
        <IntentRail
          intent={{ kind: "after", targetKind: "section", key: node.key }}
          targetKey={node.key}
          targetLabel={node.section.title}
          parentLabel={parentLabel}
          invalid={invalidIntents.has(
            dropIntentId({
              kind: "after",
              targetKind: "section",
              key: node.key,
            }),
          )}
          active={dragActive}
        />
      )}
    </div>
  );
}

/** Root-level inside target: the sheet workspace end zone. */
export function RootDropZone({
  invalid,
  empty,
}: {
  invalid: boolean;
  empty: boolean;
}) {
  const id = dropIntentId({ kind: "inside", sectionKey: null });
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { targetKey: null, targetLabel: "Top level", parentLabel: "" },
  });
  return (
    <div
      ref={setNodeRef}
      data-dnd-intent={id}
      className={
        isOver
          ? invalid
            ? "canvas-root-zone canvas-root-zone--over-invalid"
            : "canvas-root-zone canvas-root-zone--over-valid"
          : invalid
            ? "canvas-root-zone canvas-root-zone--invalid"
            : "canvas-root-zone"
      }
    >
      {empty
        ? "Drop fields or sections here to begin"
        : "Drop here for top level"}
    </div>
  );
}
