interface GenerateAiDraftDialogProps {
  open: boolean;
  mode: "pc" | "npc";
  prompt: string;
  busy: boolean;
  error: string | null;
  onModeChange(mode: "pc" | "npc"): void;
  onPromptChange(prompt: string): void;
  onClose(): void;
  onSubmit(): void;
}

/**
 * AI-assisted character creation entry (14.14). Collects the requested mode
 * and a bounded description, then asks the server for an editable proposal.
 * The returned canonical Draft enters the normal Workshop — no auto-confirm,
 * no final-generation call, no second editor.
 */
export function GenerateAiDraftDialog({
  open,
  mode,
  prompt,
  busy,
  error,
  onModeChange,
  onPromptChange,
  onClose,
  onSubmit,
}: GenerateAiDraftDialogProps) {
  if (!open) return null;
  const canSubmit = !busy && prompt.trim() !== "";
  return (
    <div
      className="character-workshop__dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Generate Character with AI"
    >
      <div className="character-workshop__dialog">
        <h2 className="character-workshop__dialog-title">
          Generate Character with AI
        </h2>
        <p className="character-workshop__dialog-hint">
          AI creates a starting draft that you can fully edit before
          confirmation.
        </p>
        <div className="character-workshop__form-field">
          <span
            className="character-workshop__identity-label"
            id="ai-draft-mode-label"
          >
            Character type
          </span>
          <div
            className="character-workshop__identity-segment"
            role="group"
            aria-labelledby="ai-draft-mode-label"
          >
            {(["pc", "npc"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={
                  mode === option
                    ? "character-workshop__identity-option character-workshop__identity-option--selected"
                    : "character-workshop__identity-option"
                }
                aria-pressed={mode === option}
                onClick={() => onModeChange(option)}
                disabled={busy}
              >
                {option === "pc" ? "PC" : "NPC"}
              </button>
            ))}
          </div>
        </div>
        <div className="character-workshop__form-field">
          <label
            className="character-workshop__identity-label"
            htmlFor="ai-draft-prompt"
          >
            Character description
          </label>
          <textarea
            id="ai-draft-prompt"
            className="character-workshop__final-textarea"
            value={prompt}
            maxLength={5000}
            rows={5}
            placeholder="A large, clumsy orc scout from the northern marshes…"
            onChange={(event) => onPromptChange(event.target.value)}
            disabled={busy}
          />
        </div>
        {busy && (
          <p className="character-workshop__final-status" role="status">
            Creating an editable draft…
          </p>
        )}
        {error !== null && (
          <p className="character-workshop__dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="character-workshop__controls">
          <button
            type="button"
            className="character-workshop__btn"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            Create editable draft with AI
          </button>
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
