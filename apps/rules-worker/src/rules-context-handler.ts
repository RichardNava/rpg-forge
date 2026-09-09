import {
  beginRulesAnalysisRun,
  confirmRulesAnalysisRun,
  readRunRulesContext,
  toPublicRulesAnalysisRun,
  type RulesAnalysisRun,
} from "@repo/rules-analysis-run";
import type { RulesAnalysisWorkflowPort } from "./infrastructure/rules-analysis-workflow.js";
import { hasJsonContentType, readBoundedJson } from "./http.js";
import { authorizeActiveSession, type AppDeps } from "./handler.js";
import {
  ConfirmationRequestSchema,
  PublicRulesAnalysisRunSchema,
  RulesAnalysisRequestSchema,
} from "./transport/schemas.js";
import { errorResponse, jsonResponse } from "./transport/errors.js";

export async function handleRulesContextRequest(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const authorized = await authorizeActiveSession(
    analysisIdPath,
    request,
    deps,
  );
  if (authorized.kind === "response") {
    return authorized.response;
  }

  if (request.method === "POST") {
    return beginRulesContext(authorized.analysisId, request, deps);
  }
  if (request.method === "GET") {
    return readRulesContext(authorized.analysisId, deps);
  }
  return errorResponse("INVALID_REQUEST", "Route not found.", 404);
}

export async function handleRulesContextConfirmation(
  analysisIdPath: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const authorized = await authorizeActiveSession(
    analysisIdPath,
    request,
    deps,
  );
  if (authorized.kind === "response") {
    return authorized.response;
  }
  if (request.method !== "POST") {
    return errorResponse("INVALID_REQUEST", "Route not found.", 404);
  }
  return confirmRulesContext(authorized.analysisId, request, deps);
}

async function beginRulesContext(
  analysisId: string,
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
  const parsed = RulesAnalysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Request body is invalid.");
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(
    `rules-context-begin:${analysisId}:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }

  if (deps.rulesAnalysisArtifactStore === undefined) {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }
  if (deps.rulesAnalysisWorkflow === undefined) {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }

  const result = await beginRulesAnalysisRun(
    {
      analysisId,
      characterIntent: parsed.data.characterIntent,
      ...(parsed.data.ruleOverrides === undefined
        ? {}
        : { ruleOverrides: parsed.data.ruleOverrides }),
    },
    {
      clock: deps.clock,
      idGenerator: deps.crypto,
      runRepository: deps.rulesAnalysisRunRepository,
      rulebookRepository: deps.rulebookRepository,
      artifactStore: deps.rulesAnalysisArtifactStore,
    },
  );

  if (result.kind === "no_ready_rulebook") {
    return errorResponse("RULES_CONTEXT_NO_READY_RULEBOOK");
  }
  if (result.kind === "storage_unavailable") {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }
  if (result.kind === "run_already_exists") {
    return existingRunResponse(result.run);
  }

  try {
    await deps.rulesAnalysisWorkflow.start({
      analysisId: result.run.analysisId,
      ingestionId: result.run.ingestionId,
      rulesAnalysisRunId: result.run.runId,
    });
  } catch {
    await compensateFailedBegin(result.run, deps);
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }
  return jsonResponse(202, { run: publicRun(result.run) });
}

async function readRulesContext(
  analysisId: string,
  deps: AppDeps,
): Promise<Response> {
  const run = await deps.rulesAnalysisRunRepository.findCurrent(analysisId);
  if (run === null) {
    return errorResponse("RULES_CONTEXT_RUN_NOT_FOUND");
  }

  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return jsonResponse(202, { run: publicRun(run), context: null });
  }
  if (run.status === "FAILED") {
    return errorResponse("RULES_CONTEXT_ANALYSIS_FAILED");
  }
  if (run.status === "INVALIDATED") {
    return errorResponse("RULES_CONTEXT_RUN_NOT_FOUND");
  }
  if (deps.rulesAnalysisArtifactStore === undefined) {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }

  const context = await readRunRulesContext(
    {
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    },
    deps.rulesAnalysisArtifactStore,
  );
  if (context === null) {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }
  return jsonResponse(200, { run: publicRun(run), context });
}

async function confirmRulesContext(
  analysisId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return errorResponse("RULES_CONTEXT_INVALID_CONFIRMATION");
  }
  const body = await readBoundedJson(request);
  if (body === null || !ConfirmationRequestSchema.safeParse(body).success) {
    return errorResponse("RULES_CONTEXT_INVALID_CONFIRMATION");
  }
  if (deps.rulesAnalysisArtifactStore === undefined) {
    return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  }

  const run = await deps.rulesAnalysisRunRepository.findCurrent(analysisId);
  if (run === null) {
    return errorResponse("RULES_CONTEXT_RUN_NOT_FOUND");
  }
  if (run.status === "READY" || run.status === "CONFIRMED") {
    return errorResponse("RULES_CONTEXT_ALREADY_READY");
  }
  if (run.status !== "CONFLICTS") {
    return errorResponse("RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID");
  }

  const result = await confirmRulesAnalysisRun(
    { analysisId, runId: run.runId },
    {
      clock: deps.clock,
      runRepository: deps.rulesAnalysisRunRepository,
      artifactStore: deps.rulesAnalysisArtifactStore,
    },
  );
  if (result.kind === "confirmed") {
    return jsonResponse(200, { run: publicRun(result.run) });
  }
  if (result.kind === "not_found_or_inactive") {
    return errorResponse("RULES_CONTEXT_RUN_NOT_FOUND");
  }
  if (result.kind === "not_confirmable") {
    return errorResponse("RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID");
  }
  return errorResponse("RULES_CONTEXT_STORAGE_UNAVAILABLE");
}

function existingRunResponse(run: RulesAnalysisRun): Response {
  if (run.status === "READY" || run.status === "CONFIRMED") {
    return errorResponse("RULES_CONTEXT_ALREADY_READY");
  }
  return jsonResponse(202, { run: publicRun(run) });
}

function publicRun(run: RulesAnalysisRun) {
  return PublicRulesAnalysisRunSchema.parse(toPublicRulesAnalysisRun(run));
}

async function compensateFailedBegin(
  run: RulesAnalysisRun,
  deps: AppDeps,
): Promise<void> {
  try {
    await deps.rulesAnalysisRunRepository.markInvalidatedIfCurrent(
      run.runId,
      deps.clock.now(),
    );
  } catch {
    // The run stays QUEUED current and is retryable on the next begin.
  }
  try {
    await deps.rulesAnalysisArtifactStore?.deleteRunArtifacts({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
  } catch {
    // Best-effort housekeeping only.
  }
}

export type { RulesAnalysisWorkflowPort };
