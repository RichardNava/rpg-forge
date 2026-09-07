import type { AnalysisResourceCleanerPort } from "@repo/rules-analysis-session";

/**
 * Phase 14.2 owns no permanent attached resources, so cleanup is a no-op.
 * Future phases compose R2 / Vectorize / Workflow cleanup behind this same
 * port without changing session lifecycle code.
 */
export function createNoOpResourceCleaner(): AnalysisResourceCleanerPort {
  return {
    async cleanup(): Promise<void> {
      // Intentional no-op until a resource phase introduces attachments.
    },
  };
}
