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
import type {
  RulebookProcessingWorkflowPort,
  RulebookRepositoryPort,
  TemporaryRulebookStoragePort,
} from "@repo/rulebook-ingestion";
import type {
  SheetSessionRepositoryPort,
  DraftHeadRepositoryPort,
} from "@repo/character-sheet-session";
import type { CharacterSheetDraftStore } from "@repo/character-sheet-draft";
import type { CharacterSheetArtifactStore } from "@repo/character-sheet-artifacts";
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
import { handleRulebookRequest } from "./rulebook-handler.js";
import {
  handleRulesContextConfirmation,
  handleRulesContextRequest,
} from "./rules-context-handler.js";
import { handleCharacterSheetRequest } from "./character-sheet-handler.js";
import type {
  RulesAnalysisRunRepositoryPort,
  RuleVectorIndexPort,
  RunArtifactPort,
} from "@repo/rules-analysis-run";
import type { RulesAnalysisWorkflowPort } from "./infrastructure/rules-analysis-workflow.js";
import type { SheetVisualExtractionPort } from "./infrastructure/sheet-visual-extraction.js";

export interface AppDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SessionRepositoryPort;
  cleaner: AnalysisResourceCleanerPort;
  humanVerifier: HumanVerificationPort;
  rateLimiter: RateLimitPort;
  rulebookRepository: RulebookRepositoryPort;
  rulebookStorage?: TemporaryRulebookStoragePort;
  rulebookWorkflow?: RulebookProcessingWorkflowPort;
  rulesAnalysisRunRepository: RulesAnalysisRunRepositoryPort;
  rulesAnalysisArtifactStore?: RunArtifactPort;
  rulesAnalysisVectorIndex?: RuleVectorIndexPort;
  rulesAnalysisWorkflow?: RulesAnalysisWorkflowPort;
  sheetSessionRepository: SheetSessionRepositoryPort;
  sheetDraftHeadRepository: DraftHeadRepositoryPort;
  sheetDraftStore?: CharacterSheetDraftStore;
  sheetArtifactStore?: CharacterSheetArtifactStore;
  sheetVisualExtraction?: SheetVisualExtractionPort;
  debugSheetDrafts?: boolean;
}

const SESSIONS_PATH = "/v1/rules-analysis/sessions";
const SESSION_PATH_PATTERN = /^\/v1\/rules-analysis\/sessions\/([^/]+)$/;
const RULEBOOK_PATH_PATTERN =
  /^\/v1\/rules-analysis\/sessions\/([^/]+)\/rulebook$/;
const RULES_CONTEXT_CONFIRM_PATH_PATTERN =
  /^\/v1\/rules-analysis\/sessions\/([^/]+)\/rules-context\/confirmation$/;
const RULES_CONTEXT_PATH_PATTERN =
  /^\/v1\/rules-analysis\/sessions\/([^/]+)\/rules-context$/;

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

  const rulesContextConfirmationMatch =
    RULES_CONTEXT_CONFIRM_PATH_PATTERN.exec(path);
  if (rulesContextConfirmationMatch !== null) {
    return handleRulesContextConfirmation(
      rulesContextConfirmationMatch[1] ?? "",
      request,
      deps,
    );
  }

  const rulesContextMatch = RULES_CONTEXT_PATH_PATTERN.exec(path);
  if (rulesContextMatch !== null) {
    return handleRulesContextRequest(rulesContextMatch[1] ?? "", request, deps);
  }

  const rulebookMatch = RULEBOOK_PATH_PATTERN.exec(path);
  if (rulebookMatch !== null) {
    return handleRulebookRequest(rulebookMatch[1] ?? "", request, deps);
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

  if (path.startsWith("/v1/character-sheets")) {
    return handleCharacterSheetRequest(request, deps);
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

export type ActiveSessionAuthorization =
  { kind: "ok"; analysisId: string } | { kind: "response"; response: Response };

/**
 * Shared session guard for analysis-session-scoped resource routes. Requires a
 * parseable analysis id and an active (non-expired, non-DELETING) session.
 */
export async function authorizeActiveSession(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<ActiveSessionAuthorization> {
  const parsedId = AnalysisIdSchema.safeParse(analysisIdPath);
  if (!parsedId.success) {
    return {
      kind: "response",
      response: errorResponse("INVALID_REQUEST", "Invalid analysis id."),
    };
  }
  const bearer = parseBearerToken(request);
  if (!bearer.ok) {
    return {
      kind: "response",
      response: errorResponse(
        "INVALID_REQUEST",
        "Missing or malformed Authorization header.",
      ),
    };
  }
  const authorization = await authorizeSession(
    parsedId.data,
    bearer.token,
    deps,
  );
  if (authorization.kind === "expired") {
    return {
      kind: "response",
      response: errorResponse("ANALYSIS_SESSION_EXPIRED"),
    };
  }
  if (
    authorization.kind !== "ok" ||
    authorization.session.status !== "ACTIVE"
  ) {
    return {
      kind: "response",
      response: errorResponse("ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED"),
    };
  }
  return { kind: "ok", analysisId: parsedId.data };
}
