export const DRAFT_ERROR_CODES = [
  "invalid_draft",
  "invalid_draft_identity",
  "corrupt_draft",
  "storage_unavailable",
  "cleanup_failed",
  "invalid_mutation",
  "field_read_locked",
  "draft_session_mismatch",
  "session_expired",
  "surface_out_of_bounds",
  "draft_inflight",
  "draft_confirmed",
  "projection_invalid",
  "writeback_invalid",
] as const;

export type DraftErrorCode = (typeof DRAFT_ERROR_CODES)[number];

/**
 * Typed failure for the character-sheet draft slice. Codes are
 * transport-neutral: domain validation, session ownership, mutation guards,
 * and the R2 draft adapter all surface failures through this one error type so
 * orchestration can distinguish recoverable storage/cleanup states from
 * invalid client intentions.
 */
export class DraftError extends Error {
  readonly code: DraftErrorCode;

  constructor(code: DraftErrorCode, message: string) {
    super(message);
    this.name = "DraftError";
    this.code = code;
  }
}

export function draftError(code: DraftErrorCode, message: string): DraftError {
  return new DraftError(code, message);
}
