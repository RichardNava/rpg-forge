interface ConfirmDialogProps {
  open: boolean;
  title: string;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onClose(): void;
}

export function ConfirmDialog({
  open,
  title,
  busy,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm character sheet"
      className="character-workshop__dialog-backdrop"
      onClick={onClose}
    >
      <div
        className="character-workshop__dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="character-workshop__panel-title">Confirm this sheet?</h2>
        <p className="character-workshop__confirm-copy">
          <strong>{title}</strong> will be locked as read-only. No further
          changes can be made after confirmation.
        </p>
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
            disabled={busy}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="character-workshop__btn"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Confirming…" : "Confirm sheet"}
          </button>
        </div>
      </div>
    </div>
  );
}
