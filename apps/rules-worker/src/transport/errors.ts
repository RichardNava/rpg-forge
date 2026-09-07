import { ErrorResponseSchema, type ErrorCode } from "./schemas.js";

const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  HUMAN_VERIFICATION_REQUIRED: 403,
  HUMAN_VERIFICATION_FAILED: 403,
  RATE_LIMITED: 429,
  RATE_LIMIT_UNAVAILABLE: 503,
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
