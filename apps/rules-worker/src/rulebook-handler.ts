import {
  isDeclaredRulebookTooLarge,
  queueRulebook,
  removeRulebook,
  removeRulebookGeneration,
  reserveRulebook,
  RulebookUploadError,
  toPublicRulebook,
  validatePdfUpload,
} from "@repo/rulebook-ingestion";
import { authorizeSession } from "@repo/rules-analysis-session";
import {
  hasPdfContentType,
  parseBearerToken,
  readDeclaredContentLength,
  requestBodyBytes,
} from "./http.js";
import { RulebookStorageUnavailableError } from "./infrastructure/r2-rulebook-storage.js";
import { RulebookWorkflowUnavailableError } from "./infrastructure/rulebook-workflow.js";
import type { AppDeps } from "./handler.js";
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
} from "./transport/errors.js";
import { AnalysisIdSchema, RulebookViewSchema } from "./transport/schemas.js";

export const RULEBOOK_UPLOAD_CONSENT_HEADER = "x-rules-upload-consent";
const RULEBOOK_UPLOAD_CONSENT_VALUE = "accepted";

export async function handleRulebookRequest(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const authorized = await authorizeActiveRulebookSession(
    analysisIdPath,
    request,
    deps,
  );
  if (authorized.kind === "response") {
    return authorized.response;
  }

  if (request.method === "PUT") {
    return putRulebook(authorized.analysisId, request, deps);
  }
  if (request.method === "GET") {
    return getRulebook(authorized.analysisId, deps);
  }
  if (request.method === "DELETE") {
    return deleteRulebook(authorized.analysisId, deps);
  }
  return errorResponse("INVALID_REQUEST", "Route not found.", 404);
}

async function putRulebook(
  analysisId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!hasUploadConsent(request)) {
    return errorResponse("RULEBOOK_UPLOAD_CONSENT_REQUIRED");
  }
  if (!hasPdfContentType(request)) {
    return errorResponse("RULEBOOK_INVALID_CONTENT_TYPE");
  }
  if (isDeclaredRulebookTooLarge(readDeclaredContentLength(request))) {
    return errorResponse("RULEBOOK_TOO_LARGE");
  }
  const bytes = requestBodyBytes(request);
  if (bytes === null) {
    return errorResponse("RULEBOOK_INVALID_PDF");
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(
    `rulebook-upload:${analysisId}:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }
  if (deps.rulebookStorage === undefined) {
    return errorResponse("RULEBOOK_STORAGE_UNAVAILABLE");
  }
  if (deps.rulebookWorkflow === undefined) {
    return errorResponse("RULEBOOK_WORKFLOW_UNAVAILABLE");
  }

  const reservation = await reserveRulebook(analysisId, {
    clock: deps.clock,
    idGenerator: deps.crypto,
    repository: deps.rulebookRepository,
  });
  if (reservation.kind === "already_attached") {
    return errorResponse("RULEBOOK_ALREADY_ATTACHED");
  }

  const { rulebook } = reservation;
  try {
    const upload = validatePdfUpload(bytes);
    await deps.rulebookStorage.putRaw({
      analysisId,
      ingestionId: rulebook.ingestionId,
      bytes: upload.bytes,
    });
    const queued = await queueRulebook(
      {
        analysisId,
        ingestionId: rulebook.ingestionId,
        sizeBytes: upload.getSizeBytes(),
      },
      deps.rulebookRepository,
    );
    if (!queued) {
      throw new Error("Rulebook queue transition was not current.");
    }
    await deps.rulebookWorkflow.start({
      analysisId,
      ingestionId: rulebook.ingestionId,
    });
    const current = await deps.rulebookRepository.findByGeneration(
      analysisId,
      rulebook.ingestionId,
    );
    if (current === null) {
      throw new Error("Rulebook disappeared before upload response.");
    }
    return jsonResponse(
      202,
      RulebookViewSchema.parse(toPublicRulebook(current)),
    );
  } catch (error) {
    await cleanupFailedAttachment(analysisId, rulebook.ingestionId, deps);
    return uploadErrorResponse(error);
  }
}

async function getRulebook(
  analysisId: string,
  deps: AppDeps,
): Promise<Response> {
  const rulebook = await deps.rulebookRepository.findByAnalysisId(analysisId);
  if (rulebook === null) {
    return errorResponse("RULEBOOK_NOT_FOUND");
  }
  return jsonResponse(
    200,
    RulebookViewSchema.parse(toPublicRulebook(rulebook)),
  );
}

async function deleteRulebook(
  analysisId: string,
  deps: AppDeps,
): Promise<Response> {
  const current = await deps.rulebookRepository.findByAnalysisId(analysisId);
  if (current === null) {
    return emptyResponse(204);
  }
  if (deps.rulebookStorage === undefined) {
    return errorResponse("RULEBOOK_STORAGE_UNAVAILABLE");
  }
  if (deps.rulebookWorkflow === undefined) {
    return errorResponse("RULEBOOK_WORKFLOW_UNAVAILABLE");
  }

  try {
    await removeRulebook(analysisId, {
      repository: deps.rulebookRepository,
      storage: deps.rulebookStorage,
      workflow: deps.rulebookWorkflow,
    });
    return emptyResponse(204);
  } catch {
    return errorResponse("RULEBOOK_PROCESSING_FAILED");
  }
}

async function authorizeActiveRulebookSession(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<
  { kind: "ok"; analysisId: string } | { kind: "response"; response: Response }
> {
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

function hasUploadConsent(request: Request): boolean {
  return (
    request.headers.get(RULEBOOK_UPLOAD_CONSENT_HEADER) ===
    RULEBOOK_UPLOAD_CONSENT_VALUE
  );
}

async function cleanupFailedAttachment(
  analysisId: string,
  ingestionId: string,
  deps: AppDeps,
): Promise<void> {
  if (
    deps.rulebookStorage === undefined ||
    deps.rulebookWorkflow === undefined
  ) {
    return;
  }
  try {
    await removeRulebookGeneration(
      { analysisId, ingestionId },
      {
        repository: deps.rulebookRepository,
        storage: deps.rulebookStorage,
        workflow: deps.rulebookWorkflow,
      },
    );
  } catch {
    // The rulebook remains DELETING for explicit retry or session expiry cleanup.
  }
}

function uploadErrorResponse(error: unknown): Response {
  if (error instanceof RulebookUploadError) {
    return errorResponse(error.code);
  }
  if (error instanceof RulebookStorageUnavailableError) {
    return errorResponse("RULEBOOK_STORAGE_UNAVAILABLE");
  }
  if (error instanceof RulebookWorkflowUnavailableError) {
    return errorResponse("RULEBOOK_WORKFLOW_UNAVAILABLE");
  }
  return errorResponse("RULEBOOK_PROCESSING_FAILED");
}
