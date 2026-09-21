import { useEffect, useId, useState, type ReactNode } from "react";
import type {
  CharacterSheetDraft,
  DraftField,
  DraftFieldType,
  DraftMutation,
  DraftValue,
} from "@repo/character-sheet-draft";

export interface FieldEditorCallbacks {
  onSetValue(key: string, value: DraftValue): void;
  onClearValue(key: string): void;
  onRemoveField(key: string): void;
  onSetFieldLabel(key: string, label: string): void;
  onSetFieldType(
    field: Extract<DraftMutation, { op: "set_field_type" }>["field"],
  ): void;
  onMoveField(key: string, sectionKey: string | null): void;
}

interface FieldEditorProps {
  field: DraftField;
  draft: CharacterSheetDraft;
  callbacks: FieldEditorCallbacks;
  disabled: boolean;
}

const FIELD_TYPES: DraftFieldType[] = [
  "text",
  "number",
  "textarea",
  "checkbox",
  "choice",
  "list",
];

/** A generic editable field; structure is intentionally behind a disclosure. */
export function FieldEditor({
  field,
  draft,
  callbacks,
  disabled,
}: FieldEditorProps) {
  const value = draft.values[field.key] ?? null;
  const readOnly = disabled || field.locked;
  const inputId = useId();
  const [label, setLabel] = useState(field.label);
  const [pendingType, setPendingType] = useState<DraftFieldType>(field.type);
  const [min, setMin] = useState(field.min?.toString() ?? "");
  const [max, setMax] = useState(field.max?.toString() ?? "");
  const [options, setOptions] = useState(field.options?.join("\n") ?? "");
  const [structureError, setStructureError] = useState<string | null>(null);
  const currentSection =
    (draft.sections ?? []).find((section) =>
      section.fieldKeys.includes(field.key),
    )?.key ?? "";

  useEffect(() => {
    setLabel(field.label);
    setPendingType(field.type);
    setMin(field.min?.toString() ?? "");
    setMax(field.max?.toString() ?? "");
    setOptions(field.options?.join("\n") ?? "");
    setStructureError(null);
  }, [field]);

  function applySettings() {
    const nextLabel = label.trim();
    if (nextLabel === "") {
      setStructureError("A field label is required.");
      return;
    }
    const nextField = { key: field.key, type: pendingType } as Extract<
      DraftMutation,
      { op: "set_field_type" }
    >["field"];
    if (pendingType === "number") {
      const parsedMin = min === "" ? undefined : Number(min);
      const parsedMax = max === "" ? undefined : Number(max);
      if (
        (parsedMin !== undefined && !Number.isFinite(parsedMin)) ||
        (parsedMax !== undefined && !Number.isFinite(parsedMax))
      ) {
        setStructureError("Bounds must be finite numbers.");
        return;
      }
      if (
        parsedMin !== undefined &&
        parsedMax !== undefined &&
        parsedMin > parsedMax
      ) {
        setStructureError("The minimum cannot exceed the maximum.");
        return;
      }
      callbacks.onSetFieldType({
        ...nextField,
        ...(parsedMin === undefined ? {} : { min: parsedMin }),
        ...(parsedMax === undefined ? {} : { max: parsedMax }),
      });
    } else if (pendingType === "choice") {
      const parsedOptions = options
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean);
      if (parsedOptions.length === 0) {
        setStructureError("A choice field needs at least one option.");
        return;
      }
      callbacks.onSetFieldType({ ...nextField, options: parsedOptions });
    } else {
      callbacks.onSetFieldType(nextField);
    }
    if (nextLabel !== field.label)
      callbacks.onSetFieldLabel(field.key, nextLabel);
    setStructureError(null);
  }

  return (
    <article
      className={
        field.type === "number"
          ? "character-workshop__field-card character-workshop__field-card--number"
          : "character-workshop__field-card"
      }
    >
      <div className="character-workshop__field-editor">
        <label className="character-workshop__field-label" htmlFor={inputId}>
          {field.label}
        </label>
        <div className="character-workshop__field-control">
          {renderEditor(field, value, readOnly, callbacks, inputId)}
        </div>
      </div>
      {!readOnly && (
        <details className="character-workshop__field-settings">
          <summary>
            Field settings
            <span className="character-workshop__sr-only">
              {" "}
              for {field.label}
            </span>
          </summary>
          <div className="character-workshop__field-settings-content">
            <label className="character-workshop__form-field">
              <span>Label</span>
              <input
                type="text"
                aria-label={`Label for ${field.label}`}
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </label>
            <label className="character-workshop__form-field">
              <span>Type</span>
              <select
                aria-label={`Type for ${field.label}`}
                value={pendingType}
                onChange={(event) => {
                  setPendingType(event.currentTarget.value as DraftFieldType);
                  setStructureError(null);
                }}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            {pendingType === "number" && (
              <div className="character-workshop__form-row">
                <label className="character-workshop__form-field">
                  <span>Minimum</span>
                  <input
                    type="number"
                    value={min}
                    onChange={(event) => setMin(event.currentTarget.value)}
                  />
                </label>
                <label className="character-workshop__form-field">
                  <span>Maximum</span>
                  <input
                    type="number"
                    value={max}
                    onChange={(event) => setMax(event.currentTarget.value)}
                  />
                </label>
              </div>
            )}
            {pendingType === "choice" && (
              <label className="character-workshop__form-field">
                <span>Options (one per line)</span>
                <textarea
                  rows={3}
                  value={options}
                  onChange={(event) => setOptions(event.currentTarget.value)}
                />
              </label>
            )}
            <label className="character-workshop__form-field">
              <span>Section</span>
              <select
                aria-label={`Assign ${field.label} to section`}
                value={currentSection}
                onChange={(event) =>
                  callbacks.onMoveField(
                    field.key,
                    event.currentTarget.value || null,
                  )
                }
              >
                <option value="">Unassigned</option>
                {(draft.sections ?? []).map((section) => (
                  <option key={section.key} value={section.key}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
            {structureError !== null && (
              <p className="character-workshop__dialog-error" role="alert">
                {structureError}
              </p>
            )}
            <div className="character-workshop__settings-actions">
              <button
                type="button"
                className="character-workshop__btn character-workshop__btn--secondary"
                onClick={applySettings}
              >
                Apply settings
              </button>
              <button
                type="button"
                className="character-workshop__btn character-workshop__btn--danger"
                onClick={() => callbacks.onRemoveField(field.key)}
              >
                Remove field
              </button>
            </div>
          </div>
        </details>
      )}
    </article>
  );
}

function typeLabel(type: DraftFieldType): string {
  return {
    text: "Text",
    number: "Number",
    textarea: "Text area",
    checkbox: "Checkbox",
    choice: "Choice",
    list: "List",
  }[type];
}

function renderEditor(
  field: DraftField,
  value: DraftValue,
  readOnly: boolean,
  callbacks: FieldEditorCallbacks,
  inputId: string,
): ReactNode {
  if (readOnly)
    return (
      <span
        className={
          value === null
            ? "character-workshop__preview-value character-workshop__preview-value--empty"
            : "character-workshop__preview-value"
        }
      >
        {previewValue(field, value) || (field.locked ? "Read-locked" : "—")}
      </span>
    );
  const updateText = (next: string) =>
    next === ""
      ? callbacks.onClearValue(field.key)
      : callbacks.onSetValue(field.key, next);
  switch (field.type) {
    case "text":
      return (
        <input
          id={inputId}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => updateText(event.currentTarget.value)}
        />
      );
    case "textarea":
      return (
        <textarea
          id={inputId}
          rows={3}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => updateText(event.currentTarget.value)}
        />
      );
    case "number":
      return (
        <input
          id={inputId}
          type="number"
          min={field.min}
          max={field.max}
          step={1}
          inputMode="numeric"
          value={typeof value === "number" ? value : ""}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") callbacks.onClearValue(field.key);
            else {
              const parsed = Number(next);
              if (Number.isFinite(parsed))
                callbacks.onSetValue(field.key, parsed);
            }
          }}
        />
      );
    case "checkbox":
      return (
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          onChange={(event) =>
            callbacks.onSetValue(field.key, event.currentTarget.checked)
          }
        />
      );
    case "choice":
      return (
        <select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => updateText(event.currentTarget.value)}
        >
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "list":
      return (
        <textarea
          id={inputId}
          rows={4}
          value={Array.isArray(value) ? value.join("\n") : ""}
          placeholder="One item per line"
          onChange={(event) => {
            const items = event.currentTarget.value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean);
            if (items.length === 0) callbacks.onClearValue(field.key);
            else callbacks.onSetValue(field.key, items);
          }}
        />
      );
  }
}

export function previewValue(field: DraftField, value: DraftValue): string {
  if (value === null || value === undefined) return "";
  if (field.type === "checkbox") return value === true ? "✓" : "";
  if (field.type === "list" && Array.isArray(value)) return value.join(" · ");
  return String(value);
}
