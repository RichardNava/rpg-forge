/**
 * Client-side validation for character-sheet document uploads. The rules live
 * in one place so the upload dialog and any extraction service share the same
 * accept boundary (PDF, PNG, JPG; bounded size). The real multimodal
 * extraction backend validates again server-side when it arrives; this is the
 * UX layer guard only.
 */

export const SHEET_UPLOAD_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export const SHEET_UPLOAD_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export const SHEET_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export type SheetUploadValidationCode =
  | "empty"
  | "unsupported_type"
  | "too_large";

export interface SheetUploadValidationResult {
  valid: boolean;
  code: SheetUploadValidationCode | null;
  message: string;
}

export interface SheetUploadFileLike {
  name: string;
  type: string;
  size: number;
}

export function validateSheetUploadFile(
  file: SheetUploadFileLike | null | undefined,
): SheetUploadValidationResult {
  if (file === null || file === undefined) {
    return {
      valid: false,
      code: "empty",
      message: "Choose a PDF, PNG or JPG document to import.",
    };
  }
  if (!SHEET_UPLOAD_ACCEPTED_MIME_TYPES.includes(file.type as never)) {
    return {
      valid: false,
      code: "unsupported_type",
      message: "Only PDF, PNG and JPG documents can be imported.",
    };
  }
  if (file.size > SHEET_UPLOAD_MAX_BYTES) {
    return {
      valid: false,
      code: "too_large",
      message: "The document is larger than 8 MiB and cannot be imported.",
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      code: "empty",
      message: "The selected document is empty.",
    };
  }
  return { valid: true, code: null, message: "" };
}