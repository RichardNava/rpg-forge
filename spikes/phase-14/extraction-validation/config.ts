/**
 * Request-shape constants for the context-instruction extraction validation
 * shim. This is a benchmark-side experiment: the model is pinned to exactly one
 * authorized candidate and is never read from environment configuration, so the
 * production SHEET_GENERATION_MODEL knob stays untouched and unset.
 */
export const AUTHORIZED_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

export const EXTRACTION_VALIDATION_NAME =
  "2C2B remote context-instruction extraction validation";

/** Output cap for the extraction shim; proposals are small JSON objects. */
export const MAX_EXTRACTION_VALIDATION_OUTPUT_TOKENS = 2048;

/** Per-fixture provider-call budget: first attempt + one correction replay. */
export const EXTRACTION_RETRY_BUDGET = 2;
