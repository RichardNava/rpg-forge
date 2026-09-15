import type {
  CharacterSheetDraft,
  DraftValue,
} from "@repo/character-sheet-draft";
import { FieldEditor } from "./FieldEditor";

export interface WorkshopSidebarCallbacks {
  onSetValue(key: string, value: DraftValue): void;
  onClearValue(key: string): void;
  onRemoveField(key: string): void;
  onAddField(): void;
}

interface WorkshopSidebarProps {
  draft: CharacterSheetDraft;
  callbacks: WorkshopSidebarCallbacks;
  disabled: boolean;
}

export function WorkshopSidebar({
  draft,
  callbacks,
  disabled,
}: WorkshopSidebarProps) {
  return (
    <section
      className="character-workshop__panel"
      aria-label={`Fields (${draft.fields.length})`}
    >
      <div className="character-workshop__panel-title">
        Fields
        <span className="character-workshop__field-count">
          {draft.fields.length}/192
        </span>
      </div>
      <div className="character-workshop__field-list">
        {draft.fields.map((field) => (
          <FieldEditor
            key={field.key}
            field={field}
            draft={draft}
            callbacks={callbacks}
            disabled={disabled}
          />
        ))}
      </div>
      {!disabled && (
        <div className="character-workshop__sidebar-footer">
          <button
            type="button"
            className="character-workshop__btn"
            onClick={callbacks.onAddField}
          >
            Add a field
          </button>
        </div>
      )}
    </section>
  );
}
