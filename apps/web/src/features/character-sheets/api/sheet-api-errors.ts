import { z } from "zod";

export const SHEET_API_PROXY_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UPSTREAM_UNAVAILABLE: "PROXY_UPSTREAM_UNAVAILABLE",
} as const;

export const SHEET_API_CLIENT_CODES = {
  INVALID_RESPONSE: "INVALID_RESPONSE",
} as const;

const SHEET_API_ERROR_ENVELOPE_SCHEMA = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string(),
  }),
});

export interface SheetApiErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Typed failure for the character-sheet API layer. `code` stays open so new
 * upstream error codes never break parsing; matching helpers can narrow it
 * against the known rules-worker taxonomy.
 */
export class SheetApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "SheetApiError";
    this.code = code;
    this.status = status;
  }
}

/** Parses an upstream error envelope into a `SheetApiError`, or null if the
 * shape is not a valid error envelope. */
export function parseSheetApiErrorBody(
  value: unknown,
  status: number,
): SheetApiError | null {
  const parsed = SHEET_API_ERROR_ENVELOPE_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return new SheetApiError(
    parsed.data.error.code,
    parsed.data.error.message,
    status,
  );
}
