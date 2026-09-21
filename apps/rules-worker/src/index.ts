import {
  MAX_CLEANUP_BATCH_SIZE,
  runExpiryCleanup,
} from "@repo/rules-analysis-session";
import { createAppDeps } from "./deps.js";
import { type Env } from "./env.js";
import { handleRequest } from "./handler.js";
export { RulebookIngestionWorkflow } from "./rulebook-ingestion-workflow.js";
export { RulesAnalysisWorkflow } from "./rules-analysis-workflow.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, createAppDeps(env));
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = createAppDeps(env);
    const result = await runExpiryCleanup({
      now: deps.clock.now(),
      repository: deps.repository,
      cleaner: deps.cleaner,
      limit: MAX_CLEANUP_BATCH_SIZE,
    });
    if (result.failed.length > 0) {
      console.warn(
        `rules-analysis cleanup: ${result.failed.length}/${result.processed} sessions failed`,
      );
    }
    const sheetCandidates = await deps.sheetSessionRepository.findCleanupCandidates(
      deps.clock.now(),
      MAX_CLEANUP_BATCH_SIZE,
    );
    for (const session of sheetCandidates) {
      const transition = await deps.sheetSessionRepository.markDeletingIfActive(
        session.sessionId,
      );
      if (transition === "not_found") continue;
      try {
        // This prefix sweep removes every snapshot, including extracted drafts.
        await deps.sheetArtifactStore?.deleteSessionArtifacts(session.sessionId);
        await deps.sheetDraftHeadRepository.deleteSessionHeads(session.sessionId);
        await deps.sheetSessionRepository.delete(session.sessionId);
      } catch {
        console.warn(`character-sheet cleanup failed for session ${session.sessionId}`);
      }
    }
  },
} satisfies ExportedHandler<Env>;
