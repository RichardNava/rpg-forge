import {
  removeRulebook,
  type RulebookProcessingWorkflowPort,
  type RulebookRepositoryPort,
  type TemporaryRulebookStoragePort,
} from "@repo/rulebook-ingestion";
import type { AnalysisResourceCleanerPort } from "@repo/rules-analysis-session";
import { RulebookStorageUnavailableError } from "./r2-rulebook-storage.js";
import { RulebookWorkflowUnavailableError } from "./rulebook-workflow.js";

export interface RulebookResourceCleanerOptions {
  repository: RulebookRepositoryPort;
  storage?: TemporaryRulebookStoragePort;
  workflow?: RulebookProcessingWorkflowPort;
}

/**
 * Session cleanup owns the rulebook lifecycle. If no rulebook exists it is a
 * no-op; if one exists, absent production bindings fail the parent cleanup so
 * its DELETING session row remains retryable rather than orphaning data.
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
      await removeRulebook(analysisId, {
        repository: options.repository,
        storage: options.storage,
        workflow: options.workflow,
      });
    },
  };
}
