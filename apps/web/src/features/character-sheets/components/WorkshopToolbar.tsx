import type { CharacterSheetDraft } from "@repo/character-sheet-draft";
import type { SheetDraftSaveStatus } from "../state/sheet-store-types";

const SAVE_STATUS_LABEL: Record<SheetDraftSaveStatus, string> = {
  idle: "Not saved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

interface WorkshopToolbarProps {
  draft: CharacterSheetDraft;
  saveStatus: SheetDraftSaveStatus;
  busy: boolean;
  onRename(title: string): void;
  onAddField(): void;
  onConfirm(): void;
  onRestart(): void;
}

export function WorkshopToolbar({
  draft,
  saveStatus,
  busy,
  onRename,
  onAddField,
  onConfirm,
  onRestart,
}: WorkshopToolbarProps) {
  const nameField = draft.fields.find(
    (field) => field.key === "character_name",
  );
  const nameEditable =
    nameField !== undefined && !nameField.locked && !draft.confirmed;
  const nameValue =
    nameField !== undefined &&
    typeof draft.values["character_name"] === "string"
      ? (draft.values["character_name"] as string)
      : "";

  return (
    <div className="character-workshop__toolbar">
      <span className="character-workshop__brand">Character Workshop</span>
      <div className="character-workshop__toolbar-title">
        {nameEditable ? (
          <input
            type="text"
            className="character-workshop__toolbar-title-input"
            value={nameValue}
            placeholder="Sheet title"
            aria-label="Sheet title"
            onChange={(event) => onRename(event.currentTarget.value)}
            disabled={busy}
          />
        ) : (
          <span className="character-workshop__toolbar-title-static">
            {draft.characterName ?? "Untitled sheet"}
          </span>
        )}
      </div>
      <div
        className={
          saveStatus === "error"
            ? "character-workshop__status character-workshop__status--error"
            : "character-workshop__status"
        }
      >
        {SAVE_STATUS_LABEL[saveStatus]}
      </div>
      <div className="character-workshop__toolbar-actions">
        {!draft.confirmed && (
          <>
            <button
              type="button"
              className="character-workshop__btn"
              onClick={onAddField}
              disabled={busy}
            >
              Add field
            </button>
            <button
              type="button"
              className="character-workshop__btn character-workshop__btn--ghost"
              onClick={onRestart}
              disabled={busy}
            >
              Start over
            </button>
            <button
              type="button"
              className="character-workshop__btn"
              onClick={onConfirm}
              disabled={busy}
            >
              Confirm sheet
            </button>
          </>
        )}
      </div>
    </div>
  );
}
