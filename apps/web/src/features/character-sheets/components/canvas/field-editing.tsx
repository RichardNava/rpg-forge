import type {
  DraftField,
  DraftLayoutNodeV1,
  DraftValue,
} from "@repo/character-sheet-draft";

/**
 * Shared field-editing controls for the sheet surface (14.9).
 *
 * `FieldValueInput` renders the value editor for one field;
 * `NodeLayoutControls` renders the durable numeric layout controls for one
 * node. Both are used by the editable Canvas (cards + inspector) with
 * identical labels, so precise editing and accessibility fallback stay
 * consistent everywhere. Every change dispatches through the caller-supplied
 * callbacks into the authoritative store/domain mutation path.
 */

export function FieldValueInput({
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

/**
 * Durable numeric layout controls (14.8 spatial foundation, not throwaway
 * UI): precise numeric editing that stays useful as an accessibility fallback
 * after direct Canvas manipulation. Every change dispatches through the
 * authoritative store/domain mutation path; there is no local-only geometry
 * state.
 */
export function NodeLayoutControls({
  nameFor,
  geometry,
  onChange,
}: {
  /** Stable accessible name basis (section title or field key). */
  nameFor: string;
  geometry: DraftLayoutNodeV1;
  onChange(placement: DraftLayoutNodeV1): void;
}) {
  function commitNumber(
    field: "columnStart" | "columnSpan" | "rowSpan",
    raw: string,
    min: number,
    max: number,
  ) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return;
    }
    if (parsed === geometry[field]) {
      return;
    }
    onChange({ ...geometry, [field]: parsed });
  }
  return (
    <>
      <label className="character-workshop__form-field">
        <span>Column start</span>
        <input
          type="number"
          aria-label={`Column start for ${nameFor}`}
          min={1}
          max={4}
          value={geometry.columnStart}
          onChange={(event) =>
            commitNumber("columnStart", event.currentTarget.value, 1, 4)
          }
        />
      </label>
      <label className="character-workshop__form-field">
        <span>Column span</span>
        <input
          type="number"
          aria-label={`Column span for ${nameFor}`}
          min={1}
          max={4}
          value={geometry.columnSpan}
          onChange={(event) =>
            commitNumber("columnSpan", event.currentTarget.value, 1, 4)
          }
        />
      </label>
      <label className="character-workshop__form-field">
        <span>Row span</span>
        <input
          type="number"
          aria-label={`Row span for ${nameFor}`}
          min={1}
          max={12}
          value={geometry.rowSpan}
          onChange={(event) =>
            commitNumber("rowSpan", event.currentTarget.value, 1, 12)
          }
        />
      </label>
      <label className="character-workshop__form-field">
        <span>Break before</span>
        <input
          type="checkbox"
          aria-label={`Break before for ${nameFor}`}
          checked={geometry.breakBefore}
          onChange={(event) =>
            onChange({ ...geometry, breakBefore: event.currentTarget.checked })
          }
        />
      </label>
    </>
  );
}
