import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type {
  CharacterSheetDraftV2,
  DraftLayoutNodeV1,
  DraftMutationV2,
  DraftValue,
} from "@repo/character-sheet-draft";
import {
  canvasAnnouncements,
  canvasCollisionDetection,
  canvasScreenReaderInstructions,
  describeDropResult,
  dropIntentId,
  parseDropIntentId,
  resolveDropDestination,
  type CanvasDropIntent,
  type CanvasNodeKind,
} from "./canvas-dnd";
import {
  CanvasFieldNode,
  CanvasSectionNode,
  RootDropZone,
} from "./canvas-nodes";
import { KeyboardMoveMenu } from "./canvas-keyboard-move";
import {
  gridContainerStyle,
  SpatialNodes,
  useSpatialSurface,
} from "./spatial-surface";
import type { CanvasSelection } from "./canvas-types";

/**
 * Visual sheet Canvas: the primary editing workspace (14.9).
 *
 * Derives everything from the canonical read model (hierarchy/order) plus
 * the effective layout (geometry); it never duplicates structure or layout
 * into shadow state. Every durable edit dispatches through the existing V2
 * store/domain mutation path via callbacks. Ephemeral interaction state
 * (selection is lifted; drag/hover/resize-preview/menu/error are local) never
 * becomes authority: drops and resizes commit exactly once, hover commits
 * nothing.
 */

export interface SheetCanvasCallbacks {
  onSetValue(key: string, value: DraftValue): void;
  onClearValue(key: string): void;
  onRemoveField(key: string): void;
  onSetFieldLabel(key: string, label: string): void;
  onSetFieldType(
    field: Extract<DraftMutationV2, { op: "set_field_type" }>["field"],
  ): void;
  onRenameSection(key: string, title: string): void;
  onPlaceNode(
    key: string,
    destination: Extract<DraftMutationV2, { op: "place_node" }>["destination"],
  ): void;
  onSetContainerLayout(containerKey: string | null, columns: number): void;
  onSetNodeLayout(key: string, placement: DraftLayoutNodeV1): void;
  onAddField(): void;
  onOpenAddSection(): void;
}

interface SheetCanvasV2Props {
  draft: CharacterSheetDraftV2;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
  selection: CanvasSelection;
  onSelectionChange(selection: CanvasSelection): void;
}

interface ActiveDrag {
  kind: CanvasNodeKind;
  key: string;
  label: string;
}

export function SheetCanvasV2({
  draft,
  callbacks,
  disabled,
  selection,
  onSelectionChange,
}: SheetCanvasV2Props) {
  const surface = useSpatialSurface(draft);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [keyboardMove, setKeyboardMove] = useState<ActiveDrag | null>(null);
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  // PointerSensor is deliberately NOT used: React onPointerDown does not
  // dispatch in this app's runtime (verified: native pointerdown fires,
  // React onMouseDown/onClick/onKeyDown fire, React onPointerDown stays
  // silent), so pointer-sensor drags can never activate. MouseSensor covers
  // mouse/trackpad input and TouchSensor covers touch input.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const labelOf = useCallback(
    (key: string): string =>
      draft.fields.find((entry) => entry.key === key)?.label ??
      draft.sections.find((entry) => entry.key === key)?.title ??
      key,
    [draft],
  );

  const announcements = useMemo(() => canvasAnnouncements(labelOf), [labelOf]);

  const invalidIntents = useMemo(() => {
    const invalid = new Set<string>();
    if (surface === null || activeDrag === null) {
      return invalid;
    }
    const context = {
      readModel: surface.readModel,
      layout: surface.layout,
      sourceKey: activeDrag.key,
      sourceKind: activeDrag.kind,
    };
    for (const node of surface.readModel.preorder) {
      for (const kind of ["before", "after"] as const) {
        const intent: CanvasDropIntent = {
          kind,
          targetKind: node.kind,
          key: node.key,
        };
        if (!resolveDropDestination(context, intent).ok) {
          invalid.add(dropIntentId(intent));
        }
      }
      if (node.kind === "section") {
        const inside: CanvasDropIntent = {
          kind: "inside",
          sectionKey: node.key,
        };
        if (!resolveDropDestination(context, inside).ok) {
          invalid.add(dropIntentId(inside));
        }
      }
    }
    const rootInside: CanvasDropIntent = { kind: "inside", sectionKey: null };
    if (!resolveDropDestination(context, rootInside).ok) {
      invalid.add(dropIntentId(rootInside));
    }
    return invalid;
  }, [surface, activeDrag]);

  if (surface === null) {
    return (
      <div className="character-workshop__panel">
        <div className="character-workshop__panel-title">Sheet canvas</div>
        <div className="character-workshop__preview-value character-workshop__preview-value--empty">
          Canvas unavailable for this draft.
        </div>
      </div>
    );
  }

  function handleDragStart(event: DragStartEvent) {
    document.title = `dragstart:${String(event.active.id)}`;
    const data = event.active.data.current as
      { kind?: unknown; key?: unknown; label?: unknown } | undefined;
    if (
      (data?.kind === "field" || data?.kind === "section") &&
      typeof data.key === "string"
    ) {
      setActiveDrag({
        kind: data.kind,
        key: data.key,
        label: typeof data.label === "string" ? data.label : data.key,
      });
    }
    setDropError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    document.title = `dragend:${String(event.active.id)}:${event.over === null || event.over === undefined ? "no-over" : String(event.over.id)}`;
    if (surface === null) {
      return;
    }
    const data = event.active.data.current as
      { kind?: unknown; key?: unknown; label?: unknown } | undefined;
    setActiveDrag(null);
    if (
      (data?.kind !== "field" && data?.kind !== "section") ||
      typeof data.key !== "string"
    ) {
      return;
    }
    const intent =
      event.over === null || event.over === undefined
        ? null
        : parseDropIntentId(String(event.over.id));
    if (intent === null) {
      return;
    }
    const label = typeof data.label === "string" ? data.label : data.key;
    const resolved = resolveDropDestination(
      {
        readModel: surface.readModel,
        layout: surface.layout,
        sourceKey: data.key,
        sourceKind: data.kind,
      },
      intent,
    );
    if (!resolved.ok) {
      setDropError(resolved.reason);
      setLiveMessage(resolved.reason);
      return;
    }
    setDropError(null);
    callbacks.onPlaceNode(data.key, resolved.destination);
    setLiveMessage(
      describeDropResult(
        draft,
        surface.readModel,
        draft.sections,
        data.key,
        label,
        resolved.destination,
      ),
    );
  }

  function handleDragCancel() {
    setActiveDrag(null);
  }

  function openKeyboardMove(entry: ActiveDrag) {
    setKeyboardMove(entry);
    setDropError(null);
    setLiveMessage(
      `Picked up ${entry.label}. Choose a destination, or press Escape to cancel.`,
    );
  }

  function closeKeyboardMove(message: string | null, focusKey: string) {
    setKeyboardMove(null);
    if (message !== null) {
      setLiveMessage(message);
    }
    const handle = document.querySelector(
      `[data-canvas-handle="${CSS.escape(focusKey)}"]`,
    );
    if (handle instanceof HTMLElement) {
      handle.focus();
    }
  }

  const guidesOn =
    activeDrag !== null || keyboardMove !== null || resizingKey !== null;

  const rootColumns = surface.layout.root.columns;

  return (
    <section
      className="character-workshop__panel character-workshop__canvas-panel"
      aria-label="Sheet canvas"
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (activeDrag !== null || keyboardMove !== null) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        onSelectionChange(null);
      }}
    >
      <header className="character-workshop__editor-header">
        <div>
          <h2 className="character-workshop__panel-title">Sheet canvas</h2>
          <p data-build-marker="14-9-canvas-7">
            Drag cards to reorder and nest. Select a card to resize or inspect
            it.
          </p>
        </div>
        {!disabled && (
          <div className="character-workshop__editor-actions">
            <button
              type="button"
              className="character-workshop__btn character-workshop__btn--secondary"
              onClick={callbacks.onOpenAddSection}
            >
              Add section
            </button>
          </div>
        )}
      </header>
      {dropError !== null && (
        <p className="character-workshop__alert" role="alert">
          {dropError}
        </p>
      )}
      <div
        aria-live="polite"
        role="status"
        className="character-workshop__sr-only"
      >
        {liveMessage}
      </div>
      <DndContext
        collisionDetection={canvasCollisionDetection}
        sensors={sensors}
        accessibility={{
          announcements,
          screenReaderInstructions: canvasScreenReaderInstructions,
        }}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="character-workshop__sheet">
          <div className="character-workshop__canvas-scroll">
            <div
              className={
                guidesOn
                  ? "character-workshop__sheet-body canvas-grid canvas-guides-on"
                  : "character-workshop__sheet-body canvas-grid"
              }
              style={{
                ...gridContainerStyle(rootColumns),
                ["--canvas-cols" as string]: rootColumns,
                minWidth: rootColumns > 2 ? `${rootColumns * 9}rem` : undefined,
              }}
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    "[data-canvas-node]",
                  ) === null
                ) {
                  onSelectionChange(null);
                }
              }}
            >
              <SpatialNodes
                surface={surface}
                nodes={surface.readModel.roots}
                renderSection={(node, children) => (
                  <CanvasSectionNode
                    draft={draft}
                    surface={surface}
                    node={node}
                    callbacks={callbacks}
                    disabled={disabled}
                    selected={
                      selection?.kind === "section" &&
                      selection.key === node.key
                    }
                    invalidIntents={invalidIntents}
                    dragActive={activeDrag !== null}
                    onSelect={() =>
                      onSelectionChange({ kind: "section", key: node.key })
                    }
                    onOpenKeyboardMove={openKeyboardMove}
                    onResizeActive={setResizingKey}
                  >
                    {children}
                  </CanvasSectionNode>
                )}
                renderField={(node) => (
                  <CanvasFieldNode
                    draft={draft}
                    surface={surface}
                    node={node}
                    callbacks={callbacks}
                    disabled={disabled}
                    selected={
                      selection?.kind === "field" && selection.key === node.key
                    }
                    invalidIntents={invalidIntents}
                    dragActive={activeDrag !== null}
                    onSelect={() =>
                      onSelectionChange({ kind: "field", key: node.key })
                    }
                    onOpenKeyboardMove={openKeyboardMove}
                    onResizeActive={setResizingKey}
                  />
                )}
              />
              {!disabled && (
                <RootDropZone
                  invalid={invalidIntents.has(
                    dropIntentId({ kind: "inside", sectionKey: null }),
                  )}
                  empty={surface.readModel.roots.length === 0}
                />
              )}
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
          {activeDrag === null ? null : (
            <span className="character-workshop__drag-overlay">
              Moving {activeDrag.label}
              <span className="character-workshop__drag-overlay-kind">
                {activeDrag.kind === "field" ? "Field" : "Section"}
              </span>
            </span>
          )}
        </DragOverlay>
      </DndContext>
      {keyboardMove !== null && !disabled && (
        <KeyboardMoveMenu
          draft={draft}
          surface={surface}
          entry={keyboardMove}
          labelOf={labelOf}
          onCommit={(destination) => {
            callbacks.onPlaceNode(keyboardMove.key, destination);
            closeKeyboardMove(
              describeDropResult(
                draft,
                surface.readModel,
                draft.sections,
                keyboardMove.key,
                keyboardMove.label,
                destination,
              ),
              keyboardMove.key,
            );
          }}
          onCancel={() => {
            closeKeyboardMove("Move cancelled.", keyboardMove.key);
          }}
        />
      )}
    </section>
  );
}
