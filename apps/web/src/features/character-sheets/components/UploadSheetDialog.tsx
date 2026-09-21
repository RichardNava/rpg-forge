"use client";

import { useState } from "react";
import {
  SHEET_UPLOAD_ACCEPT,
  validateSheetUploadFile,
} from "../lib/sheet-upload-validation";
import type { SheetDocumentFileDescriptor } from "../extraction/extraction-service";

interface SheetUploadDescriptor extends SheetDocumentFileDescriptor {
  sheetStartPage?: number;
}

interface UploadSheetDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(file: SheetUploadDescriptor): Promise<string | null>;
}

/**
 * Document import entry point. The dialog owns only the UX boundary: file
 * selection, client validation and the extraction processing state. The actual
 * document → draft extraction runs behind `onSubmit` through the extraction
 * service port, so a real multimodal backend can be connected later without
 * touching this component.
 */
export function UploadSheetDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: UploadSheetDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [hasMoreThanThreePages, setHasMoreThanThreePages] = useState(false);
  const [sheetStartPage, setSheetStartPage] = useState("1");

  if (!open) {
    return null;
  }

  function handleSelect(next: File | null) {
    const result = validateSheetUploadFile(next);
    if (!result.valid) {
      setFile(null);
      setValidationError(result.message);
      setHasMoreThanThreePages(false);
      setSheetStartPage("1");
      return;
    }
    setFile(next);
    setValidationError(null);
    setHasMoreThanThreePages(false);
    setSheetStartPage("1");
  }

  async function handleExtract() {
    if (file === null) {
      return;
    }
    const parsedStartPage = Number(sheetStartPage);
    if (
      hasMoreThanThreePages &&
      (!Number.isSafeInteger(parsedStartPage) || parsedStartPage < 1)
    ) {
      setValidationError("Enter a whole page number of 1 or greater.");
      return;
    }
    const descriptor: SheetUploadDescriptor = {
      name: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
      ...(hasMoreThanThreePages ? { sheetStartPage: parsedStartPage } : {}),
    };
    const rejection = await onSubmit(descriptor);
    if (rejection !== null) {
      setValidationError(rejection);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload an existing sheet"
      className="character-workshop__dialog-backdrop"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="character-workshop__dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="character-workshop__panel-title">
          Upload an existing sheet
        </h2>
        <p className="character-workshop__upload-copy">
          Import a <strong>PDF</strong>, <strong>PNG</strong> or{" "}
          <strong>JPG</strong> character sheet. Fields are extracted
          automatically; you can then edit them in the workshop.
        </p>

        <label className="character-workshop__upload-picker">
          <span className="character-workshop__btn">
            {file === null ? "Choose a document" : "Choose another document"}
          </span>
          <input
            type="file"
            accept={SHEET_UPLOAD_ACCEPT}
            disabled={busy}
            aria-label="Sheet document"
            aria-describedby={
              validationError === null ? undefined : "upload-error"
            }
            onChange={(event) =>
              handleSelect(event.currentTarget.files?.[0] ?? null)
            }
          />
        </label>

        {file !== null && (
          <>
            <div className="character-workshop__upload-file">
              <span className="character-workshop__upload-file-name">
                {file.name}
              </span>
              <span className="character-workshop__upload-file-size">
                {formatFileSize(file.size)}
              </span>
            </div>
            {file.type === "application/pdf" && (
              <div className="character-workshop__page-selection">
                <label className="character-workshop__page-option">
                  <input
                    type="checkbox"
                    checked={hasMoreThanThreePages}
                    disabled={busy}
                    onChange={(event) =>
                      setHasMoreThanThreePages(event.currentTarget.checked)
                    }
                  />
                  This PDF has more than 3 pages
                </label>
                {hasMoreThanThreePages && (
                  <label className="character-workshop__page-number">
                    Start extracting at page
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={sheetStartPage}
                      disabled={busy}
                      aria-describedby={
                        validationError === null ? undefined : "upload-error"
                      }
                      onChange={(event) => {
                        setSheetStartPage(event.currentTarget.value);
                        setValidationError(null);
                      }}
                    />
                  </label>
                )}
                <p className="character-workshop__page-selection-help">
                  We cannot determine PDF page counts in this browser. Select
                  the first page of the character sheet if this document has
                  additional pages.
                </p>
              </div>
            )}
          </>
        )}

        {busy && (
          <p className="character-workshop__upload-progress" role="status">
            Reading the document and extracting fields…
          </p>
        )}

        {validationError !== null && (
          <p
            id="upload-error"
            className="character-workshop__dialog-error"
            role="alert"
          >
            {validationError}
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
            className="character-workshop__btn character-workshop__btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="character-workshop__btn"
            onClick={() => void handleExtract()}
            disabled={file === null || busy}
          >
            {busy ? "Extracting…" : "Extract fields"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}
