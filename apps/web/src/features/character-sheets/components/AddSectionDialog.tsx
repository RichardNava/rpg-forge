import { useState, type FormEvent } from "react";
import type { DraftSection } from "@repo/character-sheet-draft";

interface AddSectionDialogProps {
  open: boolean;
  sections: DraftSection[];
  onClose(): void;
  onSubmit(section: DraftSection): void;
}

export function AddSectionDialog({
  open,
  sections,
  onClose,
  onSubmit,
}: AddSectionDialogProps) {
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function updateTitle(nextTitle: string) {
    setTitle(nextTitle);
    if (key === "" || key === sectionKey(title)) setKey(sectionKey(nextTitle));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextKey = key.trim();
    if (nextTitle === "") {
      setError("A section title is required.");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(nextKey)) {
      setError("Use a safe section key starting with a letter or digit.");
      return;
    }
    if (sections.some((section) => section.key === nextKey)) {
      setError(`A section with key "${nextKey}" already exists.`);
      return;
    }
    onSubmit({
      key: nextKey,
      title: nextTitle,
      fieldKeys: [],
      ...(parentKey === "" ? {} : { parentKey }),
    });
    setTitle("");
    setKey("");
    setParentKey("");
    setError(null);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a section"
      className="character-workshop__dialog-backdrop"
      onClick={onClose}
    >
      <form
        className="character-workshop__dialog"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="character-workshop__panel-title">Add a section</h2>
        <label className="character-workshop__form-field">
          <span>Section title</span>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(event) => updateTitle(event.currentTarget.value)}
          />
        </label>
        <label className="character-workshop__form-field">
          <span>Section key</span>
          <input
            type="text"
            value={key}
            onChange={(event) => setKey(event.currentTarget.value)}
          />
        </label>
        <label className="character-workshop__form-field">
          <span>Parent section</span>
          <select
            value={parentKey}
            onChange={(event) => setParentKey(event.currentTarget.value)}
          >
            <option value="">Top level</option>
            {sections.map((section) => (
              <option key={section.key} value={section.key}>
                {section.title}
              </option>
            ))}
          </select>
        </label>
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
          <button type="submit" className="character-workshop__btn">
            Add section
          </button>
        </div>
      </form>
    </div>
  );
}

function sectionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
}
