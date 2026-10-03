import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  buildDraftStructuralReadModelV2,
  type CharacterSheetDraftV2,
  type DraftField,
  type DraftMutationV2,
  type DraftReadNodeV2,
  type DraftValue,
} from "@repo/character-sheet-draft";

export interface WorkshopSidebarV2Callbacks {
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
  onAddField(): void;
  onOpenAddSection?(): void;
}

interface WorkshopSidebarV2Props {
  draft: CharacterSheetDraftV2;
  callbacks: WorkshopSidebarV2Callbacks;
  disabled: boolean;
}

export function applyWorkshopDropV2(
  source: { kind: "field" | "section"; key: string },
  target: { kind: "section"; key: string | null } | undefined,
  onPlaceNode: WorkshopSidebarV2Callbacks["onPlaceNode"],
): void {
  if (target === undefined) return;
  if (source.kind === "section" && source.key === target.key) return;
  onPlaceNode(source.key, { position: "inside", parentKey: target.key });
}

type NodeChildren = ReadonlyMap<string | null, readonly DraftReadNodeV2[]>;

/** The V2 workshop editor. Hierarchy derives exclusively from the canonical
 * read model: no `section.fieldKeys`, no `section.parentKey`, no second tree
 * authority. Root Fields and Sections stay interleaved in canonical order. */
export function WorkshopSidebarV2({
  draft,
  callbacks,
  disabled,
}: WorkshopSidebarV2Props) {
  const readModel = useMemo(
    () => buildDraftStructuralReadModelV2(draft),
    [draft],
  );
  return (
    <section
      className="character-workshop__panel character-workshop__editor"
      aria-label={`Fields (${draft.fields.length})`}
    >
      <header className="character-workshop__editor-header">
        <div>
          <h2 className="character-workshop__panel-title">Sheet fields</h2>
          <p>{draft.fields.length} of 192 fields</p>
        </div>
        {!disabled && callbacks.onOpenAddSection !== undefined && (
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
      <div className="character-workshop__field-list">
        <GroupedNodes
          draft={draft}
          nodes={readModel.roots}
          childrenByParent={readModel.childrenByParent}
          callbacks={callbacks}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

function GroupedNodes({
  draft,
  nodes,
  childrenByParent,
  callbacks,
  disabled,
}: WorkshopSidebarV2Props & {
  nodes: readonly DraftReadNodeV2[];
  childrenByParent: NodeChildren;
}) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  function handleDragEnd(event: DragEndEvent) {
    const source = event.active.data.current;
    const target = event.over?.data.current;
    setActiveLabel(null);
    if (
      (source?.kind === "field" || source?.kind === "section") &&
      typeof source.key === "string" &&
      target?.kind === "section" &&
      (typeof target.key === "string" || target.key === null)
    ) {
      applyWorkshopDropV2(
        { kind: source.kind, key: source.key },
        { kind: "section", key: target.key },
        callbacks.onPlaceNode,
      );
    }
  }
  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragStart={(event) =>
        setActiveLabel(String(event.active.data.current?.label ?? "item"))
      }
      onDragCancel={() => setActiveLabel(null)}
      onDragEnd={handleDragEnd}
    >
      <SiblingRun
        draft={draft}
        nodes={nodes}
        childrenByParent={childrenByParent}
        callbacks={callbacks}
        disabled={disabled}
      />
      <DropZone
        id="unassigned"
        label="Unassigned fields"
        data={{ kind: "section", key: null }}
      />
      <DropZone
        id="top-level"
        label="Top-level sections"
        data={{ kind: "section", key: null }}
      />
      <DragOverlay>
        {activeLabel === null ? null : (
          <span className="character-workshop__drag-overlay">
            Moving {activeLabel}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Renders one canonical sibling run: consecutive Fields share a compact grid
 * while Sections interrupt the run and resume afterwards, preserving exact
 * canonical sibling order.
 */
function SiblingRun({
  draft,
  nodes,
  childrenByParent,
  callbacks,
  disabled,
}: WorkshopSidebarV2Props & {
  nodes: readonly DraftReadNodeV2[];
  childrenByParent: NodeChildren;
}) {
  const runs: Array<
    | { kind: "fields"; nodes: Extract<DraftReadNodeV2, { kind: "field" }>[] }
    | { kind: "section"; node: Extract<DraftReadNodeV2, { kind: "section" }> }
  > = [];
  for (const node of nodes) {
    if (node.kind === "section") {
      runs.push({ kind: "section", node });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === "fields") {
      last.nodes.push(node);
    } else {
      runs.push({ kind: "fields", nodes: [node] });
    }
  }
  return (
    <>
      {runs.map((run, index) =>
        run.kind === "section" ? (
          <SectionEditorV2
            key={run.node.key}
            draft={draft}
            node={run.node}
            childrenByParent={childrenByParent}
            callbacks={callbacks}
            disabled={disabled}
            depth={run.node.depth}
          />
        ) : (
          <div
            key={`field-run-${index}`}
            className="character-workshop__field-grid"
          >
            {run.nodes.map((node) => (
              <DraggableFieldV2
                key={node.key}
                draft={draft}
                field={node.field}
                callbacks={callbacks}
                disabled={disabled}
              />
            ))}
          </div>
        ),
      )}
    </>
  );
}

function SectionEditorV2({
  draft,
  node,
  childrenByParent,
  callbacks,
  disabled,
  depth,
}: {
  draft: CharacterSheetDraftV2;
  node: Extract<DraftReadNodeV2, { kind: "section" }>;
  childrenByParent: NodeChildren;
  callbacks: WorkshopSidebarV2Callbacks;
  disabled: boolean;
  depth: number;
}) {
  const [title, setTitle] = useState(node.section.title);
  const [syncedTitle, setSyncedTitle] = useState(node.section.title);
  if (syncedTitle !== node.section.title) {
    setSyncedTitle(node.section.title);
    setTitle(node.section.title);
  }
  const descendants = useMemo(() => {
    const found = new Set<string>();
    const pending: Array<string | null> = [node.key];
    while (pending.length > 0) {
      const parent = pending.pop() ?? null;
      for (const child of childrenByParent.get(parent) ?? []) {
        if (child.kind === "section" && !found.has(child.key)) {
          found.add(child.key);
          pending.push(child.key);
        }
      }
    }
    return found;
  }, [childrenByParent, node.key]);
  const draggable = useDraggable({
    id: `section:${node.key}`,
    disabled,
    data: { kind: "section", key: node.key, label: node.section.title },
  });
  const {
    attributes: sectionAttributes,
    listeners: sectionListeners,
    setActivatorNodeRef: setSectionActivatorRef,
  } = draggable;
  const droppable = useDroppable({
    id: `section-target:${node.key}`,
    data: { kind: "section", key: node.key },
  });
  function commitTitle() {
    const next = title.trim();
    if (next === "") setTitle(node.section.title);
    else if (next !== node.section.title)
      callbacks.onRenameSection(node.key, next);
  }
  const children = childrenByParent.get(node.key) ?? [];
  return (
    <section
      ref={(element) => {
        draggable.setNodeRef(element);
        droppable.setNodeRef(element);
      }}
      className="character-workshop__field-group"
      data-depth={depth}
      aria-labelledby={`section-${node.key}`}
    >
      <div className="character-workshop__section-heading">
        <h3
          id={`section-${node.key}`}
          className="character-workshop__field-group-title"
        >
          {node.section.title}
        </h3>
        {!disabled && (
          <button
            type="button"
            className="character-workshop__drag-handle"
            ref={(element) => {
              setSectionActivatorRef(element);
            }}
            {...sectionListeners}
            {...sectionAttributes}
          >
            Move section
          </button>
        )}
        {!disabled && (
          <details className="character-workshop__section-settings">
            <summary>
              Section settings
              <span className="character-workshop__sr-only">
                {" "}
                for {node.section.title}
              </span>
            </summary>
            <div>
              <label className="character-workshop__form-field">
                <span>Section title</span>
                <input
                  aria-label={`Title for ${node.section.title}`}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="character-workshop__form-field">
                <span>Parent section</span>
                <select
                  aria-label={`Parent section for ${node.section.title}`}
                  value={node.parentKey ?? ""}
                  onChange={(event) =>
                    callbacks.onPlaceNode(node.key, {
                      position: "inside",
                      parentKey: event.currentTarget.value || null,
                    })
                  }
                >
                  <option value="">Top level</option>
                  {draft.sections
                    .filter(
                      (candidate) =>
                        candidate.key !== node.key &&
                        !descendants.has(candidate.key),
                    )
                    .map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
        )}
      </div>
      <SiblingRun
        draft={draft}
        nodes={children}
        childrenByParent={childrenByParent}
        callbacks={callbacks}
        disabled={disabled}
      />
    </section>
  );
}

function DraggableFieldV2({
  field,
  draft,
  callbacks,
  disabled,
}: {
  field: DraftField;
  draft: CharacterSheetDraftV2;
  callbacks: WorkshopSidebarV2Callbacks;
  disabled: boolean;
}) {
  const draggable = useDraggable({
    id: `field:${field.key}`,
    disabled,
    data: { kind: "field", key: field.key, label: field.label },
  });
  const { attributes, listeners, setActivatorNodeRef, setNodeRef } = draggable;
  return (
    <div
      ref={(element) => {
        setNodeRef(element);
      }}
      className="character-workshop__draggable-field"
    >
      <button
        type="button"
        className="character-workshop__drag-handle"
        aria-label={`Move ${field.label}`}
        ref={(element) => {
          setActivatorNodeRef(element);
        }}
        {...listeners}
        {...attributes}
      >
        Move
      </button>
      <FieldCardV2
        field={field}
        draft={draft}
        callbacks={callbacks}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Compact V2 field card, rendered directly against the V2 structural read
 * model. Shared CSS classes keep the visual language identical to the
 * rest of the workshop.
 */
function FieldCardV2({
  field,
  draft,
  callbacks,
  disabled,
}: {
  field: DraftField;
  draft: CharacterSheetDraftV2;
  callbacks: WorkshopSidebarV2Callbacks;
  disabled: boolean;
}) {
  const value = draft.values[field.key] ?? null;
  const readOnly = disabled || field.locked;
  const [label, setLabel] = useState(field.label);
  const [syncedLabel, setSyncedLabel] = useState(field.label);
  if (syncedLabel !== field.label) {
    setSyncedLabel(field.label);
    setLabel(field.label);
  }
  function commitLabel() {
    const next = label.trim();
    if (next === "") setLabel(field.label);
    else if (next !== field.label) callbacks.onSetFieldLabel(field.key, next);
  }
  return (
    <article
      className={
        field.type === "number"
          ? "character-workshop__field-card character-workshop__field-card--number"
          : "character-workshop__field-card"
      }
    >
      <label className="character-workshop__field-label">
        {field.label}
        <FieldValueInput
          field={field}
          value={value}
          readOnly={readOnly}
          onSetValue={(next) => callbacks.onSetValue(field.key, next)}
          onClearValue={() => callbacks.onClearValue(field.key)}
        />
      </label>
      {!readOnly && (
        <div className="character-workshop__field-actions">
          <input
            aria-label={`Label for ${field.key}`}
            type="text"
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            onBlur={commitLabel}
          />
          <button
            type="button"
            onClick={() => callbacks.onRemoveField(field.key)}
          >
            Remove
          </button>
        </div>
      )}
    </article>
  );
}

function FieldValueInput({
  field,
  value,
  readOnly,
  onSetValue,
  onClearValue,
}: {
  field: DraftField;
  value: DraftValue;
  readOnly: boolean;
  onSetValue(value: DraftValue): void;
  onClearValue(): void;
}) {
  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        aria-label={field.label}
        checked={value === true}
        disabled={readOnly}
        onChange={(event) => onSetValue(event.currentTarget.checked)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        aria-label={field.label}
        value={typeof value === "number" ? value : ""}
        min={field.min}
        max={field.max}
        disabled={readOnly}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === "") onClearValue();
          else onSetValue(Number(next));
        }}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        aria-label={field.label}
        value={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onChange={(event) => onSetValue(event.currentTarget.value)}
      />
    );
  }
  if (field.type === "choice") {
    return (
      <select
        aria-label={field.label}
        value={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onChange={(event) => onSetValue(event.currentTarget.value)}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "list") {
    const items = Array.isArray(value) ? value : [];
    return (
      <input
        aria-label={field.label}
        type="text"
        value={items.join(", ")}
        disabled={readOnly}
        onChange={(event) =>
          onSetValue(
            event.currentTarget.value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry !== ""),
          )
        }
      />
    );
  }
  return (
    <input
      type="text"
      aria-label={field.label}
      value={typeof value === "string" ? value : ""}
      disabled={readOnly}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (next === "") onClearValue();
        else onSetValue(next);
      }}
    />
  );
}

function DropZone({
  id,
  label,
  data,
}: {
  id: string;
  label: string;
  data: { kind: "section"; key: string | null };
}) {
  const droppable = useDroppable({ id, data });
  const { isOver, setNodeRef } = droppable;
  return (
    <div
      ref={(element) => {
        setNodeRef(element);
      }}
      className={
        isOver
          ? "character-workshop__drop-zone character-workshop__drop-zone--active"
          : "character-workshop__drop-zone"
      }
    >
      {label}
    </div>
  );
}
