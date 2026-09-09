import {
  MAX_RULEBOOK_CHUNKS,
  type RulebookChunk,
  type RulebookRepositoryPort,
} from "@repo/rulebook-ingestion";
import type { Clock } from "@repo/rules-analysis-session";
import {
  RuleOverrideSchema,
  RulesContextSchema,
  validateRulesContextDomain,
  type CharacterIntent,
  type RuleOverride,
  type RulesContext,
} from "@repo/rules-context";
import {
  EMBEDDING_BATCH_SIZE,
  RULES_EMBEDDING_DIMENSIONS,
  RulesAnalysisRequestSchema,
  RETRIEVAL_TOP_K,
  type RuleBuildFailureCode,
  type RuleOverrideInput,
  type RulesAnalysisInputArtifact,
  type RulesAnalysisRun,
} from "./model.js";
import {
  type AnalysisPromptEvidence,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildQueryText,
} from "./prompt.js";
import {
  embeddingShapeError,
  parseAnalysisOutput,
  type GenerateValidatedOutputOptions,
} from "./generate.js";
import {
  AnalysisEvidenceError,
  mapAnalysisOutputToRulesContext,
  verifyEvidence,
  type RulesAnalysisOutput,
} from "./output.js";
import type {
  ChunkSourcePort,
  EmbeddingsPort,
  RetrievalRecord,
  RuleAnalysisPort,
  RuleVectorIndexPort,
  RetrievedVector,
  RulebookFileHashPort,
  RunArtifactPort,
  VectorRecord,
} from "./ports.js";
import type { RulesAnalysisRunRepositoryPort } from "./repository.js";
import { buildUploadedRulebookSource, rulebookSourceId } from "./provenance.js";

export interface RunIdGenerator {
  uuid(): string;
}

export interface BeginRulesAnalysisRunDeps {
  clock: Clock;
  idGenerator: RunIdGenerator;
  runRepository: RulesAnalysisRunRepositoryPort;
  rulebookRepository: RulebookRepositoryPort;
  artifactStore: RunArtifactPort;
}

export interface BeginRulesAnalysisRunInput {
  analysisId: string;
  characterIntent: CharacterIntent;
  ruleOverrides?: readonly RuleOverrideInput[];
}

export type BeginRulesAnalysisRunResult =
  | { kind: "started"; run: RulesAnalysisRun }
  | { kind: "no_ready_rulebook" }
  | { kind: "run_already_exists"; run: RulesAnalysisRun }
  | { kind: "storage_unavailable" };

export async function beginRulesAnalysisRun(
  input: BeginRulesAnalysisRunInput,
  deps: BeginRulesAnalysisRunDeps,
): Promise<BeginRulesAnalysisRunResult> {
  const request = RulesAnalysisRequestSchema.parse(
    input.ruleOverrides === undefined
      ? { characterIntent: input.characterIntent }
      : {
          characterIntent: input.characterIntent,
          ruleOverrides: input.ruleOverrides,
        },
  );

  const rulebook = await deps.rulebookRepository.findByAnalysisId(
    input.analysisId,
  );
  if (rulebook === null || rulebook.status !== "READY") {
    return { kind: "no_ready_rulebook" };
  }

  const existing = await deps.runRepository.findCurrent(input.analysisId);
  if (existing !== null && existing.status !== "FAILED") {
    return { kind: "run_already_exists", run: existing };
  }

  const sourceId = rulebookSourceId(rulebook.ingestionId);
  const overrides: readonly RuleOverride[] =
    request.ruleOverrides === undefined
      ? []
      : request.ruleOverrides.map((override) =>
          RuleOverrideSchema.parse({
            id: deps.idGenerator.uuid(),
            key: override.key,
            summary: override.summary,
            sourceId,
            ...(override.structuredValue === undefined
              ? {}
              : { structuredValue: override.structuredValue }),
          }),
        );

  const now = deps.clock.now();
  const run: RulesAnalysisRun = {
    runId: deps.idGenerator.uuid(),
    analysisId: input.analysisId,
    ingestionId: rulebook.ingestionId,
    status: "QUEUED",
    failureCode: null,
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await deps.artifactStore.putInput({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
      characterIntent: request.characterIntent,
      ruleOverrides: overrides,
    });
  } catch {
    return { kind: "storage_unavailable" };
  }

  const created = await deps.runRepository.createCurrent(run);
  if (created === "superseded") {
    await bestEffortDeleteRunArtifacts(deps.artifactStore, {
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
    const raced = await deps.runRepository.findCurrent(input.analysisId);
    return {
      kind: "run_already_exists",
      run: raced ?? run,
    };
  }

  const current = await deps.runRepository.findCurrent(input.analysisId);
  return current === null || current.runId !== run.runId
    ? { kind: "run_already_exists", run: current ?? run }
    : { kind: "started", run: current };
}

export interface RunRulesAnalysisRunDeps {
  clock: Clock;
  runRepository: RulesAnalysisRunRepositoryPort;
  rulebookRepository: RulebookRepositoryPort;
  chunkSource: ChunkSourcePort;
  fileHash: RulebookFileHashPort;
  embeddings: EmbeddingsPort;
  vectorIndex: RuleVectorIndexPort;
  analysis: RuleAnalysisPort;
  artifactStore: RunArtifactPort;
}

export type RunRulesAnalysisRunResult =
  | { kind: "completed"; status: "READY" | "CONFLICTS"; run: RulesAnalysisRun }
  | { kind: "failed"; failureCode: RuleBuildFailureCode }
  | { kind: "not_current" }
  | { kind: "rulebook_unavailable" };

export async function runRulesAnalysisRun(
  input: { analysisId: string; runId: string },
  deps: RunRulesAnalysisRunDeps,
): Promise<RunRulesAnalysisRunResult> {
  const run = await deps.runRepository.findRun(input.analysisId, input.runId);
  if (run === null) {
    return { kind: "not_current" };
  }

  const claim = await deps.runRepository.claimRunningIfCurrent(
    input.runId,
    run.analysisId,
    run.ingestionId,
  );
  if (claim !== "claimed") {
    return { kind: "not_current" };
  }

  const rulebook = await deps.rulebookRepository.findByAnalysisId(
    input.analysisId,
  );
  if (
    rulebook === null ||
    rulebook.status !== "READY" ||
    rulebook.ingestionId !== run.ingestionId
  ) {
    await deps.runRepository.markInvalidatedIfCurrent(
      input.runId,
      deps.clock.now(),
    );
    return { kind: "rulebook_unavailable" };
  }

  const requestArtifact = await readRunInput(deps.artifactStore, run);
  if (requestArtifact === null) {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_STORAGE_UNAVAILABLE",
      deps,
    );
  }
  const characterIntent = requestArtifact.characterIntent;
  const overrides = requestArtifact.ruleOverrides;

  let chunks: readonly RulebookChunk[];
  try {
    chunks = await deps.chunkSource.readChunks({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
    });
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_CHUNK_SOURCE_UNAVAILABLE",
      deps,
    );
  }
  if (chunks.length === 0 || chunks.length > MAX_RULEBOOK_CHUNKS) {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_RULEBOOK_UNREADABLE",
      deps,
    );
  }

  let sha256: string;
  try {
    sha256 = await deps.fileHash.hashRulebookRaw({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
    });
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_STORAGE_UNAVAILABLE",
      deps,
    );
  }

  const source = buildUploadedRulebookSource({
    ingestionId: run.ingestionId,
    fileSize: rulebook.sizeBytes,
    pageCount: rulebook.pageCount,
    sha256,
  });

  let vectors: readonly VectorRecord[];
  try {
    vectors = await embedChunks(deps.embeddings, chunks);
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_MODEL_UNAVAILABLE",
      deps,
    );
  }
  if (vectors.length !== chunks.length) {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_MODEL_UNAVAILABLE",
      deps,
    );
  }

  try {
    await deps.vectorIndex.upsert({
      namespace: run.ingestionId,
      vectors,
    });
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_INDEX_UNAVAILABLE",
      deps,
    );
  }

  const vectorIds = vectors.map((vector) => vector.id);
  try {
    await deps.artifactStore.putVectorManifest({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
      vectorIds,
    });
  } catch {
    // The manifest could not be persisted, so the index now holds orphaned
    // vectors no invalidation pass could find. Delete them directly.
    await safeDeleteVectors(deps.vectorIndex, run.ingestionId, vectorIds);
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_STORAGE_UNAVAILABLE",
      deps,
    );
  }

  const queryText = buildQueryText({ characterIntent, overrides });

  let queryVector: number[];
  try {
    const embedded = await deps.embeddings.embed([queryText]);
    const maybe = embedded[0];
    if (maybe === undefined || maybe.length !== RULES_EMBEDDING_DIMENSIONS) {
      throw embeddingShapeError;
    }
    queryVector = maybe;
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_MODEL_UNAVAILABLE",
      deps,
    );
  }

  let retrieved: readonly RetrievedVector[];
  try {
    retrieved = await deps.vectorIndex.query({
      namespace: run.ingestionId,
      vector: queryVector,
      topK: RETRIEVAL_TOP_K,
    });
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_INDEX_UNAVAILABLE",
      deps,
    );
  }

  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const retrievedChunkIds = new Set<string>();
  const evidenceItems: AnalysisPromptEvidence[] = [];
  for (const vector of retrieved) {
    if (retrievedChunkIds.has(vector.id)) {
      continue;
    }
    const chunk = chunkById.get(vector.id);
    if (chunk === undefined) {
      continue;
    }
    retrievedChunkIds.add(vector.id);
    evidenceItems.push({
      chunkId: chunk.chunkId,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      text: chunk.text,
    });
  }

  let output: RulesAnalysisOutput | null;
  try {
    output = await generateValidatedOutput({
      promptInput: {
        characterIntent,
        overrides,
        source,
        evidence: evidenceItems,
      },
      chunksById: chunkById,
      retrievedChunkIds,
      analysis: deps.analysis,
    });
  } catch {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_MODEL_UNAVAILABLE",
      deps,
    );
  }
  if (output === null) {
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_ANALYSIS_OUTPUT_INVALID",
      deps,
    );
  }

  let context: RulesContext;
  try {
    context = mapAnalysisOutputToRulesContext({
      analysisId: run.analysisId,
      source,
      chunks,
      retrievedChunkIds,
      characterIntent,
      overrides,
      output,
    });
    const domain = validateRulesContextDomain(context);
    if (!domain.valid) {
      throw new Error("RulesContext domain validation failed.");
    }
  } catch (error) {
    if (error instanceof AnalysisEvidenceError) {
      return failCurrentRun(
        input,
        run.ingestionId,
        "RULES_CONTEXT_ANALYSIS_OUTPUT_INVALID",
        deps,
      );
    }
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_DOMAIN_INVALID",
      deps,
    );
  }

  const status = context.conflicts.length > 0 ? "CONFLICTS" : "READY";

  const retrievalRecord: RetrievalRecord = {
    version: 1,
    runId: input.runId,
    analysisId: run.analysisId,
    ingestionId: run.ingestionId,
    queryText,
    retrieved: evidenceItems.map((evidence) => ({
      chunkId: evidence.chunkId,
      pageStart: evidence.pageStart,
      pageEnd: evidence.pageEnd,
    })),
  };

  try {
    await deps.artifactStore.putContext({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
      context,
    });
    await deps.artifactStore.putRetrieval({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
      retrieval: retrievalRecord,
    });
  } catch {
    // Context/retrieval are canonical in R2, so a failed write must fail the
    // run before finalization. failCurrentRun deletes vectors via manifest.
    return failCurrentRun(
      input,
      run.ingestionId,
      "RULES_CONTEXT_STORAGE_UNAVAILABLE",
      deps,
    );
  }

  const finalized = await deps.runRepository.finalizeIfCurrent(input.runId, {
    status,
    updatedAt: deps.clock.now(),
  });
  if (!finalized) {
    return { kind: "not_current" };
  }

  const completed = await deps.runRepository.findRun(
    input.analysisId,
    input.runId,
  );
  return completed === null
    ? { kind: "completed", status, run }
    : { kind: "completed", status, run: completed };
}

export interface ConfirmRulesAnalysisRunDeps {
  clock: Clock;
  runRepository: RulesAnalysisRunRepositoryPort;
  artifactStore: RunArtifactPort;
}

export type ConfirmRulesAnalysisRunResult =
  | { kind: "confirmed"; run: RulesAnalysisRun }
  | { kind: "not_found_or_inactive" }
  | { kind: "not_confirmable" }
  | { kind: "storage_unavailable" };

export const CONFIRMED_CONFLICT_RESOLUTION_DESCRIPTION =
  "User explicitly confirmed the analysis output for this conflict.";

export async function confirmRulesAnalysisRun(
  input: { analysisId: string; runId: string },
  deps: ConfirmRulesAnalysisRunDeps,
): Promise<ConfirmRulesAnalysisRunResult> {
  const run = await deps.runRepository.findRun(input.analysisId, input.runId);
  if (run === null || !run.isCurrent) {
    return { kind: "not_found_or_inactive" };
  }
  if (run.status !== "CONFLICTS") {
    return { kind: "not_confirmable" };
  }

  let context: RulesContext;
  try {
    const stored = await deps.artifactStore.getContext({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
    if (stored === null) {
      return { kind: "not_confirmable" };
    }
    context = stored;
  } catch {
    return { kind: "storage_unavailable" };
  }

  const confirmedContext = confirmContextConflicts(context);
  const domain = validateRulesContextDomain(confirmedContext);
  if (!domain.valid) {
    return { kind: "not_confirmable" };
  }

  try {
    await deps.artifactStore.putContext({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
      context: confirmedContext,
    });
  } catch {
    return { kind: "storage_unavailable" };
  }

  const saved = await deps.runRepository.confirmIfCurrent(input.runId, {
    analysisId: run.analysisId,
    ingestionId: run.ingestionId,
    updatedAt: deps.clock.now(),
  });
  if (!saved) {
    return { kind: "not_found_or_inactive" };
  }

  const confirmed = await deps.runRepository.findRun(
    input.analysisId,
    input.runId,
  );
  return confirmed === null
    ? { kind: "not_found_or_inactive" }
    : { kind: "confirmed", run: confirmed };
}

function confirmContextConflicts(context: RulesContext): RulesContext {
  const conflicts = context.conflicts.map((conflict) =>
    conflict.status === "resolved"
      ? conflict
      : {
          ...conflict,
          status: "resolved" as const,
          resolution: {
            kind: "user" as const,
            description: CONFIRMED_CONFLICT_RESOLUTION_DESCRIPTION,
          },
        },
  );
  return RulesContextSchema.parse({
    ...context,
    schemaVersion: "1",
    conflicts,
    status: "ready" as const,
  });
}

export interface InvalidateRulebookSemanticsDeps {
  runRepository: RulesAnalysisRunRepositoryPort;
  vectorIndex: RuleVectorIndexPort;
  artifactStore: RunArtifactPort;
}

export async function invalidateRulebookSemantics(
  input: { analysisId: string; ingestionId: string },
  deps: InvalidateRulebookSemanticsDeps,
): Promise<{ invalidated: number }> {
  const runs = await deps.runRepository.invalidateRunsForGeneration(
    input.analysisId,
    input.ingestionId,
  );
  for (const run of runs) {
    await safeDeleteVectorsForRun(deps, {
      analysisId: run.analysisId,
      ingestionId: input.ingestionId,
      runId: run.runId,
    });
    try {
      await deps.artifactStore.deleteRunArtifacts({
        analysisId: run.analysisId,
        ingestionId: input.ingestionId,
        runId: run.runId,
      });
    } catch {
      // The D1 invalidation is authoritative; artifact removal is best-effort.
    }
  }
  return { invalidated: runs.length };
}

/**
 * Reads the currently stored context artifact. Returns null when the artifact
 * is absent or unreadable; a finalized run always has one, so the caller can
 * surface "context unavailable" without leaking storage internals.
 */
export async function readRunRulesContext(
  input: { analysisId: string; ingestionId: string; runId: string },
  artifactStore: RunArtifactPort,
): Promise<RulesContext | null> {
  try {
    return await artifactStore.getContext(input);
  } catch {
    return null;
  }
}

async function readRunInput(
  artifactStore: RunArtifactPort,
  run: RulesAnalysisRun,
): Promise<RulesAnalysisInputArtifact | null> {
  try {
    return await artifactStore.getInput({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
  } catch {
    return null;
  }
}

async function embedChunks(
  embeddings: EmbeddingsPort,
  chunks: readonly RulebookChunk[],
): Promise<readonly VectorRecord[]> {
  const vectors: VectorRecord[] = [];
  for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const embedded = await embeddings.embed(batch.map((chunk) => chunk.text));
    if (embedded.length !== batch.length) {
      throw embeddingShapeError;
    }
    for (let index = 0; index < batch.length; index += 1) {
      const chunk = batch[index];
      const values = embedded[index];
      if (chunk === undefined || values === undefined) {
        throw embeddingShapeError;
      }
      if (values.length !== RULES_EMBEDDING_DIMENSIONS) {
        throw embeddingShapeError;
      }
      vectors.push({ id: chunk.chunkId, values });
    }
  }
  return vectors;
}

async function generateValidatedOutput(
  options: GenerateValidatedOutputOptions,
): Promise<RulesAnalysisOutput | null> {
  const system = buildAnalysisSystemPrompt(options.promptInput);
  const user = buildAnalysisUserPrompt(options.promptInput);
  let feedback: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userMessage =
      feedback === null
        ? user
        : `${user}\n\nThe previous response failed validation. Correct the JSON, keep every chunkId from the retrieved data, quote only text that actually appears in the cited chunk, and return ONLY the corrected object.\n\nValidation feedback:\n${feedback}`;
    const raw = await options.analysis.generate({
      system,
      user: userMessage,
    });
    const parsed = parseAnalysisOutput(raw);
    if (parsed.ok) {
      const invalid = verifyEvidence(
        parsed.output,
        options.chunksById,
        options.retrievedChunkIds,
      );
      if (invalid === null) {
        return parsed.output;
      }
      feedback = invalid;
    } else {
      feedback = parsed.error;
    }
  }
  return null;
}

async function failCurrentRun(
  input: { runId: string; analysisId: string },
  ingestionId: string,
  failureCode: RuleBuildFailureCode,
  deps: RunRulesAnalysisRunDeps,
): Promise<RunRulesAnalysisRunResult> {
  const marked = await deps.runRepository.markFailedIfCurrent(
    input.runId,
    failureCode,
    deps.clock.now(),
  );
  if (marked) {
    await safeDeleteVectorsForRun(deps, {
      analysisId: input.analysisId,
      ingestionId,
      runId: input.runId,
    });
  }
  return { kind: "failed", failureCode };
}

async function safeDeleteVectorsForRun(
  deps: { vectorIndex: RuleVectorIndexPort; artifactStore: RunArtifactPort },
  input: { analysisId: string; ingestionId: string; runId: string },
): Promise<void> {
  let ids: readonly string[] = [];
  try {
    const manifest = await deps.artifactStore.getVectorManifest(input);
    ids = manifest ?? [];
  } catch {
    // Ignored: without a manifest we cannot enumerate vectors.
  }
  await safeDeleteVectors(deps.vectorIndex, input.ingestionId, ids);
}

async function safeDeleteVectors(
  vectorIndex: RuleVectorIndexPort,
  namespace: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  try {
    await vectorIndex.deleteByIds({ namespace, ids });
  } catch {
    // Best-effort: invalidation must not be blocked by an unreachable index.
  }
}

async function bestEffortDeleteRunArtifacts(
  artifactStore: RunArtifactPort,
  input: { analysisId: string; ingestionId: string; runId: string },
): Promise<void> {
  try {
    await artifactStore.deleteRunArtifacts(input);
  } catch {
    // Best-effort housekeeping only.
  }
}
