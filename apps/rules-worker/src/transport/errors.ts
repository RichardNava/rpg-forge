import { ErrorResponseSchema, type ErrorCode } from "./schemas.js";

const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  HUMAN_VERIFICATION_REQUIRED: 403,
  HUMAN_VERIFICATION_FAILED: 403,
  RATE_LIMITED: 429,
  RATE_LIMIT_UNAVAILABLE: 503,
  RULEBOOK_UPLOAD_CONSENT_REQUIRED: 403,
  RULEBOOK_INVALID_CONTENT_TYPE: 415,
  RULEBOOK_TOO_LARGE: 413,
  RULEBOOK_INVALID_PDF: 400,
  RULEBOOK_TOO_MANY_PAGES: 422,
  RULEBOOK_REQUIRES_OCR: 422,
  RULEBOOK_ALREADY_ATTACHED: 409,
  RULEBOOK_NOT_FOUND: 404,
  RULEBOOK_STORAGE_UNAVAILABLE: 503,
  RULEBOOK_WORKFLOW_UNAVAILABLE: 503,
  RULEBOOK_PROCESSING_FAILED: 500,
  RULEBOOK_EXTRACTION_TOO_LARGE: 422,
  RULEBOOK_TOO_MANY_CHUNKS: 422,
  RULES_CONTEXT_NO_READY_RULEBOOK: 409,
  RULES_CONTEXT_STORAGE_UNAVAILABLE: 503,
  RULES_CONTEXT_INDEX_UNAVAILABLE: 503,
  RULES_CONTEXT_MODEL_UNAVAILABLE: 503,
  RULES_CONTEXT_RUN_NOT_FOUND: 404,
  RULES_CONTEXT_ALREADY_READY: 409,
  RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID: 409,
  RULES_CONTEXT_ANALYSIS_FAILED: 500,
  RULES_CONTEXT_INVALID_CONFIRMATION: 400,
  ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED: 404,
  ANALYSIS_SESSION_EXPIRED: 410,
  ANALYSIS_SESSION_DELETE_FAILED: 500,
  INTERNAL_ERROR: 500,
};

const ERROR_DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  INVALID_REQUEST: "The request is malformed or invalid.",
  HUMAN_VERIFICATION_REQUIRED:
    "Human verification is required to complete this request.",
  HUMAN_VERIFICATION_FAILED: "Human verification failed. Please try again.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  RATE_LIMIT_UNAVAILABLE:
    "Rate limiting is unavailable. Please try again later.",
  RULEBOOK_UPLOAD_CONSENT_REQUIRED:
    "Upload consent is required before attaching a rulebook.",
  RULEBOOK_INVALID_CONTENT_TYPE: "Expected application/pdf.",
  RULEBOOK_TOO_LARGE: "The rulebook exceeds the 50 MiB upload limit.",
  RULEBOOK_INVALID_PDF: "The uploaded file is not a valid PDF.",
  RULEBOOK_TOO_MANY_PAGES: "The rulebook exceeds the 500-page limit.",
  RULEBOOK_REQUIRES_OCR:
    "The rulebook does not contain enough selectable text and requires OCR.",
  RULEBOOK_ALREADY_ATTACHED:
    "Remove the current rulebook before attaching another one.",
  RULEBOOK_NOT_FOUND: "No rulebook is attached to this analysis session.",
  RULEBOOK_STORAGE_UNAVAILABLE:
    "Temporary rulebook storage is unavailable. Please try again later.",
  RULEBOOK_WORKFLOW_UNAVAILABLE:
    "Rulebook processing is unavailable. Please try again later.",
  RULEBOOK_PROCESSING_FAILED: "The rulebook could not be processed.",
  RULEBOOK_EXTRACTION_TOO_LARGE:
    "The rulebook contains more extractable text than this temporary service supports.",
  RULEBOOK_TOO_MANY_CHUNKS:
    "The rulebook would create too many temporary text chunks.",
  RULES_CONTEXT_NO_READY_RULEBOOK:
    "A ready rulebook is required before analysis can begin.",
  RULES_CONTEXT_STORAGE_UNAVAILABLE:
    "Rules analysis storage is unavailable. Please try again later.",
  RULES_CONTEXT_INDEX_UNAVAILABLE:
    "The rules vector index is unavailable. Please try again later.",
  RULES_CONTEXT_MODEL_UNAVAILABLE:
    "The rules analysis model is unavailable. Please try again later.",
  RULES_CONTEXT_RUN_NOT_FOUND: "No rules analysis run exists for this session.",
  RULES_CONTEXT_ALREADY_READY: "The rules context is already ready.",
  RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID:
    "Confirmation is not needed, or the current run cannot be confirmed.",
  RULES_CONTEXT_ANALYSIS_FAILED: "The rules analysis run has failed.",
  RULES_CONTEXT_INVALID_CONFIRMATION: "The confirmation request is invalid.",
  ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED:
    "The analysis session was not found or the supplied credentials are invalid.",
  ANALYSIS_SESSION_EXPIRED: "This analysis session has expired.",
  ANALYSIS_SESSION_DELETE_FAILED: "The analysis session could not be deleted.",
  INTERNAL_ERROR: "An internal error occurred.",
};

export function errorResponse(
  code: ErrorCode,
  message?: string,
  status?: number,
): Response {
  const body = ErrorResponseSchema.parse({
    error: { code, message: message ?? ERROR_DEFAULT_MESSAGE[code] },
  });
  return jsonResponse(status ?? ERROR_HTTP_STATUS[code], body);
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}
