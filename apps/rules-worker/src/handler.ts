import {
  authorizeSession,
  createAnalysisSession,
  deleteSession,
  toPublicSession,
  type AnalysisResourceCleanerPort,
  type Clock,
  type HumanVerificationPort,
  type RateLimitPort,
  type SessionRepositoryPort,
  type SessionCrypto,
} from "@repo/rules-analysis-session";
import {
  parseBearerToken,
  hasJsonContentType,
  readBoundedJson,
} from "./http.js";
import { errorResponse, jsonResponse } from "./transport/errors.js";
import {
  AnalysisIdSchema,
  CreateSessionRequestSchema,
} from "./transport/schemas.js";

export interface AppDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SessionRepositoryPort;
  cleaner: AnalysisResourceCleanerPort;
  humanVerifier: HumanVerificationPort;
  rateLimiter: RateLimitPort;
}

const SESSIONS_PATH = "/v1/rules-analysis/sessions";
const SESSION_PATH_PATTERN = /^\/v1\/rules-analysis\/sessions\/([^/]+)$/;

export async function handleRequest(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (method === "POST" && path === SESSIONS_PATH) {
    return handleCreateSession(request, deps);
  }

  const match = SESSION_PATH_PATTERN.exec(path);
  if (match !== null) {
    const analysisId = match[1] ?? "";
    if (method === "GET") {
      return handleGetSession(analysisId, request, deps);
    }
    if (method === "DELETE") {
      return handleDeleteSession(analysisId, request, deps);
    }
  }

  return errorResponse("INVALID_REQUEST", "Route not found.", 404);
}

async function handleCreateSession(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }
  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Request body is invalid.");
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";

  const rateLimit = await deps.rateLimiter.consume(
    `create-session:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }

  const verification = await deps.humanVerifier.verify(
    parsed.data.turnstileToken,
    { clientIp },
  );
  if (verification.kind === "unavailable") {
    return errorResponse("HUMAN_VERIFICATION_REQUIRED");
  }
  if (verification.kind === "failed") {
    return errorResponse("HUMAN_VERIFICATION_FAILED");
  }

  const created = await createAnalysisSession(deps);
  return jsonResponse(201, {
    analysisId: created.analysisId,
    accessToken: created.accessToken,
    expiresAt: created.expiresAt.toISOString(),
  });
}

async function handleGetSession(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const parsedId = AnalysisIdSchema.safeParse(analysisIdPath);
  if (!parsedId.success) {
    return errorResponse("INVALID_REQUEST", "Invalid analysis id.");
  }
  const bearer = parseBearerToken(request);
  if (!bearer.ok) {
    return errorResponse(
      "INVALID_REQUEST",
      "Missing or malformed Authorization header.",
    );
  }
  const auth = await authorizeSession(parsedId.data, bearer.token, deps);
  if (auth.kind === "ok") {
    return jsonResponse(200, toPublicSession(auth.session));
  }
  if (auth.kind === "expired") {
    return errorResponse("ANALYSIS_SESSION_EXPIRED");
  }
  return errorResponse("ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED");
}

async function handleDeleteSession(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const parsedId = AnalysisIdSchema.safeParse(analysisIdPath);
  if (!parsedId.success) {
    return errorResponse("INVALID_REQUEST", "Invalid analysis id.");
  }
  const bearer = parseBearerToken(request);
  if (!bearer.ok) {
    return errorResponse(
      "INVALID_REQUEST",
      "Missing or malformed Authorization header.",
    );
  }
  try {
    const result = await deleteSession(parsedId.data, bearer.token, deps);
    if (result.kind === "deleted") {
      return jsonResponse(200, { deleted: true });
    }
    if (result.kind === "expired") {
      return errorResponse("ANALYSIS_SESSION_EXPIRED");
    }
    return errorResponse("ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED");
  } catch {
    return errorResponse("ANALYSIS_SESSION_DELETE_FAILED");
  }
}
