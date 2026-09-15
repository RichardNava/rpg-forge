import { useState, type FormEvent } from "react";
import type {
  DraftAddField,
  DraftFieldType,
} from "@repo/character-sheet-draft";

const FIELD_TYPES: Array<{ value: DraftFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "textarea", label: "Text area" },
  { value: "checkbox", label: "Checkbox" },
  { value: "choice", label: "Choice" },
];

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

interface AddFieldDialogProps {
  open: boolean;
  onClose(): void;
  onSubmit(field: DraftAddField): Promise<string | null>;
  existingKeys: string[];
}

export function AddFieldDialog({
  open,
  onClose,
  onSubmit,
  existingKeys,
}: AddFieldDialogProps) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState<DraftFieldType>("text");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return null;
  }

  function syncKeyFromLabel(nextLabel: string) {
    setLabel(nextLabel);
    if (key.length === 0 || key.toLowerCase() === slugify(label)) {
      setKey(slugify(nextLabel));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedKey = key.trim();
    const trimmedLabel = label.trim();

    if (trimmedLabel === "") {
      setError("A label is required.");
      return;
    }
    if (!KEY_PATTERN.test(trimmedKey)) {
      setError(
        "The key must start with a letter or digit and use only letters, digits, dot, underscore, colon or dash.",
      );
      return;
    }
    if (existingKeys.includes(trimmedKey)) {
      setError(`A field with key "${trimmedKey}" already exists.`);
      return;
    }

    const field: DraftAddField = {
      key: trimmedKey,
      label: trimmedLabel,
      type,
      locked: false,
    };
    if (type === "number") {
      if (min !== "") {
        const parsedMin = Number(min);
        if (!Number.isFinite(parsedMin)) {
          setError("The minimum must be a number.");
          return;
        }
        field.min = parsedMin;
      }
      if (max !== "") {
        const parsedMax = Number(max);
        if (!Number.isFinite(parsedMax)) {
          setError("The maximum must be a number.");
          return;
        }
        field.max = parsedMax;
      }
      if (
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      ) {
        setError("The minimum cannot exceed the maximum.");
        return;
      }
    }
    if (type === "choice") {
      const parsedOptions = options
        .split("\n")
        .map((option) => option.trim())
        .filter((option) => option !== "");
      if (parsedOptions.length < 1) {
        setError("A choice field needs at least one option.");
        return;
      }
      field.options = parsedOptions;
    }

    setBusy(true);
    const rejection = await onSubmit(field);
    setBusy(false);
    if (rejection !== null) {
      setError(rejection);
      return;
    }

    setLabel("");
    setKey("");
    setType("text");
    setMin("");
    setMax("");
    setOptions("");
    setError(null);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a field"
      className="character-workshop__dialog-backdrop"
      onClick={onClose}
    >
      <form
        className="character-workshop__dialog"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="character-workshop__panel-title">Add a field</h2>

        <label className="character-workshop__form-field">
          <span>Label</span>
          <input
            type="text"
            value={label}
            onChange={(event) => syncKeyFromLabel(event.currentTarget.value)}
            autoFocus
          />
        </label>

        <label className="character-workshop__form-field">
          <span>Key</span>
          <input
            type="text"
            value={key}
            placeholder="character_name"
            onChange={(event) => setKey(event.currentTarget.value)}
          />
        </label>

        <label className="character-workshop__form-field">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) =>
              setType(event.currentTarget.value as DraftFieldType)
            }
          >
            {FIELD_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        {type === "number" && (
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

        {type === "choice" && (
          <label className="character-workshop__form-field">
            <span>Options (one per line)</span>
            <textarea
              rows={4}
              value={options}
              onChange={(event) => setOptions(event.currentTarget.value)}
            />
          </label>
        )}

        {error !== null && (
          <p className="character-workshop__dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="character-workshop__controls">
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="character-workshop__btn"
            disabled={busy}
          >
            {busy ? "Adding…" : "Add field"}
          </button>
        </div>
      </form>
    </div>
  );
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  return slug;
}
