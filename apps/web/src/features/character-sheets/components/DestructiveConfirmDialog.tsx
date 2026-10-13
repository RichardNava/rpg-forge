interface DestructiveConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onClose(): void;
}

export function DestructiveConfirmDialog({
  open,
  title,
  message,
  busy,
  error,
  onConfirm,
  onClose,
}: DestructiveConfirmDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="character-workshop__dialog-backdrop"
      onClick={onClose}
    >
      <div
        className="character-workshop__dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="character-workshop__panel-title">{title}</h2>
        <p className="character-workshop__confirm-copy">{message}</p>
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
            Cancel
          </button>
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--destructive"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}