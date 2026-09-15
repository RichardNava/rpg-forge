import type { ReactNode } from "react";
import type {
  CharacterSheetDraft,
  DraftField,
  DraftValue,
} from "@repo/character-sheet-draft";

export interface FieldEditorCallbacks {
  onSetValue(key: string, value: DraftValue): void;
  onClearValue(key: string): void;
  onRemoveField(key: string): void;
}

interface FieldEditorProps {
  field: DraftField;
  draft: CharacterSheetDraft;
  callbacks: FieldEditorCallbacks;
  disabled: boolean;
}

/**
 * Renders one editable draft field as a parchment card. All control logic is
 * schema driven: only the five generic draft field types exist, so no game
 * system is ever embedded here.
 */
export function FieldEditor({
  field,
  draft,
  callbacks,
  disabled,
}: FieldEditorProps) {
  const value = draft.values[field.key] ?? null;
  const readOnly = disabled || field.locked;

  return (
    <div className="character-workshop__field-card">
      <label className="character-workshop__field-editor">
        <span className="character-workshop__field-label">{field.label}</span>
        <span className="character-workshop__field-control">
          {renderEditor(field, value, readOnly, callbacks)}
        </span>
      </label>
      <div className="character-workshop__controls">
        {!disabled && (
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--danger"
            aria-label={`Remove ${field.label}`}
            title="Remove field"
            onClick={() => callbacks.onRemoveField(field.key)}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function renderEditor(
  field: DraftField,
  value: DraftValue,
  readOnly: boolean,
  callbacks: FieldEditorCallbacks,
): ReactNode {
  if (readOnly) {
    const rendered = previewValue(field, value);
    return (
      <span
        className={
          rendered === ""
            ? "character-workshop__preview-value character-workshop__preview-value--empty"
            : "character-workshop__preview-value"
        }
      >
        {rendered === "" ? (field.locked ? "Read-locked" : "—") : rendered}
      </span>
    );
  }
  switch (field.type) {
    case "text":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          placeholder="—"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") {
              callbacks.onClearValue(field.key);
            } else {
              callbacks.onSetValue(field.key, next);
            }
          }}
        />
      );
    case "textarea":
      return (
        <textarea
          rows={3}
          value={typeof value === "string" ? value : ""}
          placeholder="—"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") {
              callbacks.onClearValue(field.key);
            } else {
              callbacks.onSetValue(field.key, next);
            }
          }}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          placeholder="—"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") {
              callbacks.onClearValue(field.key);
              return;
            }
            const parsed = Number(next);
            if (Number.isFinite(parsed)) {
              callbacks.onSetValue(field.key, parsed);
            }
          }}
        />
      );
    case "checkbox":
      return (
        <input
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
          value={typeof value === "string" ? value : ""}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") {
              callbacks.onClearValue(field.key);
            } else {
              callbacks.onSetValue(field.key, next);
            }
          }}
        >
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
  }
}

/** Renders a raw draft value as a preview string (shared by editors + preview). */
export function previewValue(field: DraftField, value: DraftValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "checkbox") {
    return value === true ? "✓" : "";
  }
  return String(value);
}
