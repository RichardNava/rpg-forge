import {
  invalidateRulebookSemantics,
  type RulesAnalysisRun,
  type RuleVectorIndexPort,
  type RunArtifactPort,
  type RulesAnalysisRunRepositoryPort,
} from "@repo/rules-analysis-run";
import {
  removeRulebook,
  type RulebookProcessingWorkflowPort,
  type RulebookRepositoryPort,
  type TemporaryRulebookStoragePort,
} from "@repo/rulebook-ingestion";
import type { AnalysisResourceCleanerPort } from "@repo/rules-analysis-session";
import { RuleArtifactUnavailableError } from "./r2-rule-artifacts.js";
import { RulebookStorageUnavailableError } from "./r2-rulebook-storage.js";
import { RulebookWorkflowUnavailableError } from "./rulebook-workflow.js";
import { VectorIndexUnavailableError } from "./vectorize-index.js";

export interface RulebookSemanticInvalidationOptions {
  runRepository: RulesAnalysisRunRepositoryPort;
  artifactStore?: RunArtifactPort;
  vectorIndex?: RuleVectorIndexPort;
}

/**
 * Invalidates every non-FAILED run of a rulebook generation and deletes its
 * derived R2 artifacts and indexed vectors. The D1 transition is authoritative;
 * the domain keeps vector/artifact deletion best-effort so invalidation can
 * never be blocked by an unreachable store or index.
 */
export async function invalidateRulebookSemanticsForGeneration(
  input: { analysisId: string; ingestionId: string },
  options: RulebookSemanticInvalidationOptions,
): Promise<void> {
  if (options.artifactStore === undefined) {
    throw new RuleArtifactUnavailableError();
  }
  if (options.vectorIndex === undefined) {
    throw new VectorIndexUnavailableError();
  }
  await invalidateRulebookSemantics(input, {
    runRepository: options.runRepository,
    artifactStore: options.artifactStore,
    vectorIndex: options.vectorIndex,
  });
}

export interface RulebookResourceCleanerOptions {
  repository: RulebookRepositoryPort;
  storage?: TemporaryRulebookStoragePort;
  workflow?: RulebookProcessingWorkflowPort;
  runRepository: RulesAnalysisRunRepositoryPort;
  artifactStore?: RunArtifactPort;
  vectorIndex?: RuleVectorIndexPort;
}

/**
 * Session cleanup owns the rulebook and its derived rule-analysis data. If no
 * rulebook exists it is a no-op; if one exists, absent production bindings fail
 * the parent cleanup so its DELETING session row remains retryable rather than
 * orphaning rulebook or derived run data.
 */
export function createRulebookResourceCleaner(
  options: RulebookResourceCleanerOptions,
): AnalysisResourceCleanerPort {
  return {
    async cleanup(analysisId: string): Promise<void> {
      const current = await options.repository.findByAnalysisId(analysisId);
      if (current === null) {
        return;
      }
      if (options.storage === undefined) {
        throw new RulebookStorageUnavailableError();
      }
      if (options.workflow === undefined) {
        throw new RulebookWorkflowUnavailableError();
      }

      const runs = await options.runRepository.listForAnalysis(analysisId);
      if (runs.length > 0) {
        if (options.artifactStore === undefined) {
          throw new RuleArtifactUnavailableError();
        }
        if (options.vectorIndex === undefined) {
          throw new VectorIndexUnavailableError();
        }
        if (current.status === "READY") {
          await invalidateRulebookSemantics(
            { analysisId, ingestionId: current.ingestionId },
            {
              runRepository: options.runRepository,
              artifactStore: options.artifactStore,
              vectorIndex: options.vectorIndex,
            },
          );
        }
        for (const run of runs) {
          await removeRunSemantics(run, {
            artifactStore: options.artifactStore,
            vectorIndex: options.vectorIndex,
          });
        }
        await options.runRepository.deleteAllForAnalysis(analysisId);
      }

      await removeRulebook(analysisId, {
        repository: options.repository,
        storage: options.storage,
        workflow: options.workflow,
      });
    },
  };
}

async function removeRunSemantics(
  run: RulesAnalysisRun,
  deps: { artifactStore: RunArtifactPort; vectorIndex: RuleVectorIndexPort },
): Promise<void> {
  let vectorIds: readonly string[] = [];
  try {
    const manifest = await deps.artifactStore.getVectorManifest({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
    vectorIds = manifest ?? [];
  } catch {
    // Without a manifest the vectors cannot be enumerated; best-effort only.
  }
  if (vectorIds.length > 0) {
    try {
      await deps.vectorIndex.deleteByIds({
        namespace: run.ingestionId,
        ids: vectorIds,
      });
    } catch {
      // Best-effort: teardown must not be blocked by an unreachable index.
    }
  }
  try {
    await deps.artifactStore.deleteRunArtifacts({
      analysisId: run.analysisId,
      ingestionId: run.ingestionId,
      runId: run.runId,
    });
  } catch {
    // Best-effort: the D1 run-rows deletion is authoritative for teardown.
  }
}
