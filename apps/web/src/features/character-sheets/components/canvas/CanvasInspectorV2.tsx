import { useMemo, useState } from "react";
import type {
  CharacterSheetDraftV2,
  DraftField,
  DraftFieldType,
  DraftLayoutNodeV1,
  DraftMutationV2,
} from "@repo/character-sheet-draft";
import { DEFAULT_DRAFT_NODE_LAYOUT_V1 } from "@repo/character-sheet-draft";
import { validMoveTargets } from "./canvas-dnd";
import { FieldValueInput, NodeLayoutControls } from "./field-editing";
import { useSpatialSurface, type SpatialSurface } from "./spatial-surface";
import type { SheetCanvasCallbacks } from "./SheetCanvasV2";
import type { CanvasSelection } from "./canvas-types";

const FIELD_TYPES: Array<{ value: DraftFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "textarea", label: "Text area" },
  { value: "checkbox", label: "Checkbox" },
  { value: "choice", label: "Choice" },
];

/**
 * Selection inspector for the sheet Canvas (14.9).
 *
 * The durable 14.8 controls live on here as the precise/accessibility
 * fallback for direct manipulation: sheet columns, per-node grid geometry
 * (visual mini-grid plus numeric inputs), an equivalent Move control, and
 * the existing content editing (label/type/value/remove, title/parent).
 * Everything dispatches through the authoritative store/domain path.
 * Confirmed drafts render read-only context with no editing affordances.
 */
export function CanvasInspectorV2({
  draft,
  selection,
  callbacks,
  disabled,
  labelOf,
}: {
  draft: CharacterSheetDraftV2;
  selection: CanvasSelection;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
  labelOf: (key: string) => string;
}) {
  const surface = useSpatialSurface(draft);
  if (surface === null) {
    return (
      <div>
        <h2 className="character-workshop__panel-title">Inspector</h2>
        <p className="canvas-inspector__meta">
          Inspector unavailable for this draft.
        </p>
      </div>
    );
  }
  if (selection === null) {
    return (
      <SheetOverview draft={draft} callbacks={callbacks} disabled={disabled} />
    );
  }
  if (selection.kind === "field") {
    const field = draft.fields.find((entry) => entry.key === selection.key);
    if (field === undefined) {
      return (
        <SheetOverview
          draft={draft}
          callbacks={callbacks}
          disabled={disabled}
        />
      );
    }
    return (
      <FieldInspector
        draft={draft}
        surface={surface}
        field={field}
        callbacks={callbacks}
        disabled={disabled}
      />
    );
  }
  const section = draft.sections.find((entry) => entry.key === selection.key);
  if (section === undefined) {
    return (
      <SheetOverview draft={draft} callbacks={callbacks} disabled={disabled} />
    );
  }
  return (
    <SectionInspector
      draft={draft}
      surface={surface}
      sectionKey={section.key}
      callbacks={callbacks}
      disabled={disabled}
      labelOf={labelOf}
    />
  );
}

function SheetOverview({
  draft,
  callbacks,
  disabled,
}: {
  draft: CharacterSheetDraftV2;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
}) {
  return (
    <div>
      <h2 className="character-workshop__panel-title">Sheet</h2>
      <p className="canvas-inspector__hint">
        Select a field or section to inspect it, or drag cards to rearrange the
        sheet.
      </p>
      <p className="canvas-inspector__meta">
        {draft.fields.length} of 192 fields · {draft.sections.length} sections
      </p>
      {!disabled && (
        <label className="character-workshop__form-field">
          <span>Sheet columns</span>
          <select
            aria-label="Sheet columns"
            value={draft.layout?.root.columns ?? 1}
            onChange={(event) =>
              callbacks.onSetContainerLayout(
                null,
                Number(event.currentTarget.value),
              )
            }
          >
            {[1, 2, 3, 4].map((columns) => (
              <option key={columns} value={columns}>
                {columns}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function FieldInspector({
  draft,
  surface,
  field,
  callbacks,
  disabled,
}: {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  field: DraftField;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
}) {
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
    <div>
      <h2 className="character-workshop__panel-title">Field: {field.label}</h2>
      {!disabled && (
        <>
          <label className="character-workshop__form-field">
            <span>Label</span>
            <input
              aria-label={`Label for ${field.key}`}
              type="text"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              onBlur={commitLabel}
            />
          </label>
          <label className="character-workshop__form-field">
            <span>Type</span>
            <select
              aria-label={`Type for ${field.label}`}
              value={field.type}
              onChange={(event) =>
                callbacks.onSetFieldType({
                  key: field.key,
                  type: event.currentTarget.value as DraftFieldType,
                })
              }
            >
              {FIELD_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="character-workshop__form-field">
        <span>Value</span>
        <FieldValueInput
          field={field}
          value={draft.values[field.key] ?? null}
          readOnly={readOnly}
          onSetValue={(next) => callbacks.onSetValue(field.key, next)}
          onClearValue={() => callbacks.onClearValue(field.key)}
        />
      </div>
      {!disabled && (
        <>
          <PositionSection
            nameFor={field.label}
            title="Position"
            geometry={
              surface.layout.nodes[field.key] ?? {
                ...DEFAULT_DRAFT_NODE_LAYOUT_V1,
              }
            }
            parentColumns={parentColumnsOf(surface, field.key)}
            onChange={(placement) =>
              callbacks.onSetNodeLayout(field.key, placement)
            }
          />
          <MoveControl
            draft={draft}
            surface={surface}
            sourceKey={field.key}
            sourceKind="field"
            onMove={(destination) =>
              callbacks.onPlaceNode(field.key, destination)
            }
          />
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--ghost"
            onClick={() => callbacks.onRemoveField(field.key)}
          >
            Remove field
          </button>
        </>
      )}
    </div>
  );
}

function SectionInspector({
  draft,
  surface,
  sectionKey,
  callbacks,
  disabled,
  labelOf,
}: {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  sectionKey: string;
  callbacks: SheetCanvasCallbacks;
  disabled: boolean;
  labelOf: (key: string) => string;
}) {
  const section = draft.sections.find((entry) => entry.key === sectionKey);
  const placement = surface.readModel.nodeByKey.get(sectionKey);
  const [title, setTitle] = useState(section?.title ?? "");
  const [syncedTitle, setSyncedTitle] = useState(section?.title ?? "");
  const currentTitle = section?.title ?? sectionKey;
  if (syncedTitle !== currentTitle) {
    setSyncedTitle(currentTitle);
    setTitle(currentTitle);
  }
  const descendants = useMemo(() => {
    const found = new Set<string>();
    const pending: Array<string | null> = [sectionKey];
    while (pending.length > 0) {
      const parent = pending.pop() ?? null;
      for (const child of surface.readModel.childrenByParent.get(parent) ??
        []) {
        if (child.kind === "section" && !found.has(child.key)) {
          found.add(child.key);
          pending.push(child.key);
        }
      }
    }
    return found;
  }, [surface, sectionKey]);
  if (section === undefined || placement?.kind !== "section") {
    return null;
  }
  const parentTitle =
    placement.parentKey === null
      ? "Top level"
      : (labelOf(placement.parentKey) ?? placement.parentKey);
  function commitTitle() {
    const next = title.trim();
    if (next === "") setTitle(currentTitle);
    else if (next !== currentTitle) callbacks.onRenameSection(sectionKey, next);
  }
  return (
    <div>
      <h2 className="character-workshop__panel-title">
        Section: {currentTitle}
      </h2>
      <p className="canvas-inspector__meta">Inside {parentTitle}</p>
      {!disabled && (
        <>
          <label className="character-workshop__form-field">
            <span>Section title</span>
            <input
              aria-label={`Title for ${currentTitle}`}
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
              aria-label={`Parent section for ${currentTitle}`}
              value={placement.parentKey ?? ""}
              onChange={(event) =>
                callbacks.onPlaceNode(sectionKey, {
                  position: "inside",
                  parentKey: event.currentTarget.value || null,
                })
              }
            >
              <option value="">Top level</option>
              {draft.sections
                .filter(
                  (candidate) =>
                    candidate.key !== sectionKey &&
                    !descendants.has(candidate.key),
                )
                .map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="character-workshop__form-field">
            <span>Columns</span>
            <select
              aria-label={`Columns for ${currentTitle}`}
              value={surface.layout.sections[sectionKey]?.columns ?? 1}
              onChange={(event) =>
                callbacks.onSetContainerLayout(
                  sectionKey,
                  Number(event.currentTarget.value),
                )
              }
            >
              {[1, 2, 3, 4].map((columns) => (
                <option key={columns} value={columns}>
                  {columns}
                </option>
              ))}
            </select>
          </label>
          <PositionSection
            nameFor={currentTitle}
            title="Node position"
            geometry={
              surface.layout.nodes[sectionKey] ?? {
                ...DEFAULT_DRAFT_NODE_LAYOUT_V1,
              }
            }
            parentColumns={parentColumnsOf(surface, sectionKey)}
            onChange={(placement) =>
              callbacks.onSetNodeLayout(sectionKey, placement)
            }
          />
          <MoveControl
            draft={draft}
            surface={surface}
            sourceKey={sectionKey}
            sourceKind="section"
            onMove={(destination) =>
              callbacks.onPlaceNode(sectionKey, destination)
            }
          />
        </>
      )}
    </div>
  );
}

/** Visual placement: mini-grid occupancy + precise numeric fallback. */
function PositionSection({
  nameFor,
  title,
  geometry,
  parentColumns,
  onChange,
}: {
  nameFor: string;
  title: string;
  geometry: DraftLayoutNodeV1;
  parentColumns: number;
  onChange(placement: DraftLayoutNodeV1): void;
}) {
  return (
    <fieldset className="canvas-position">
      <legend>{title}</legend>
      <MiniGrid
        nameFor={nameFor}
        columns={parentColumns}
        geometry={geometry}
        onChange={onChange}
      />
      <NodeLayoutControls
        nameFor={nameFor}
        geometry={geometry}
        onChange={onChange}
      />
    </fieldset>
  );
}

/**
 * Occupancy mini-grid: one button per parent column. Activating a cell moves
 * the node start there when its span still fits, and reports otherwise.
 * Position language stays grid-free in labels ("Position"/column ordinals).
 */
function MiniGrid({
  nameFor,
  columns,
  geometry,
  onChange,
}: {
  nameFor: string;
  columns: number;
  geometry: DraftLayoutNodeV1;
  onChange(placement: DraftLayoutNodeV1): void;
}) {
  const cells = Array.from({ length: columns }, (_, index) => index + 1);
  return (
    <div
      className="canvas-mini-grid"
      role="group"
      aria-label={`Position in ${columns} columns for ${nameFor}`}
      style={{ ["--mini-columns" as string]: columns }}
    >
      {cells.map((column) => {
        const occupied =
          column >= geometry.columnStart &&
          column < geometry.columnStart + geometry.columnSpan;
        return (
          <button
            key={column}
            type="button"
            className={
              occupied
                ? "canvas-mini-cell canvas-mini-cell--occupied"
                : "canvas-mini-cell"
            }
            aria-pressed={occupied}
            aria-label={`Column ${column} of ${columns} for ${nameFor}${occupied ? ", occupied" : ""}`}
            onClick={() => {
              if (column === geometry.columnStart) {
                return;
              }
              if (column + geometry.columnSpan - 1 > columns) {
                return;
              }
              onChange({ ...geometry, columnStart: column });
            }}
          >
            {column}
          </button>
        );
      })}
    </div>
  );
}

function MoveControl({
  draft,
  surface,
  sourceKey,
  sourceKind,
  onMove,
}: {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  sourceKey: string;
  sourceKind: "field" | "section";
  onMove(
    destination: Extract<DraftMutationV2, { op: "place_node" }>["destination"],
  ): void;
}) {
  const targets = useMemo(
    () =>
      validMoveTargets(
        surface.readModel,
        surface.layout,
        draft.sections,
        sourceKey,
        sourceKind,
        (key) =>
          draft.fields.find((entry) => entry.key === key)?.label ??
          draft.sections.find((entry) => entry.key === key)?.title ??
          key,
      ),
    [surface, draft, sourceKey, sourceKind],
  );
  const [choice, setChoice] = useState(targets[0]?.id ?? "");
  const current = targets.find((entry) => entry.id === choice) ?? targets[0];
  if (targets.length === 0) {
    return (
      <p className="canvas-inspector__meta">No valid destinations right now.</p>
    );
  }
  return (
    <div className="canvas-move">
      <label className="character-workshop__form-field">
        <span>Move to</span>
        <select
          aria-label={`Move destination`}
          value={current?.id ?? ""}
          onChange={(event) => setChoice(event.currentTarget.value)}
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="character-workshop__btn character-workshop__btn--secondary"
        disabled={current === undefined}
        onClick={() => {
          if (current !== undefined) {
            onMove(current.destination);
          }
        }}
      >
        Move here
      </button>
    </div>
  );
}

function parentColumnsOf(surface: SpatialSurface, key: string): number {
  const placement = surface.readModel.nodeByKey.get(key);
  const parentKey = placement?.parentKey ?? null;
  if (parentKey === null) {
    return surface.layout.root.columns;
  }
  return surface.layout.sections[parentKey]?.columns ?? 1;
}
