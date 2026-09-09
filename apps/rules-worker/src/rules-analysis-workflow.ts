import {
  runRulesAnalysisRun,
  type RunRulesAnalysisRunResult,
  type RuleBuildFailureCode,
} from "@repo/rules-analysis-run";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { createD1RulesAnalysisRunRepository } from "./infrastructure/db/run-repository.js";
import { systemClock } from "./infrastructure/clock.js";
import { createRulesAnalysisRunDeps } from "./deps.js";
import type { Env } from "./env.js";

export interface RulesAnalysisWorkflowParams {
  analysisId: string;
  ingestionId: string;
  rulesAnalysisRunId: string;
}

export type RulesAnalysisWorkflowResult =
  | { kind: "completed"; status: "READY" | "CONFLICTS" }
  | { kind: "failed"; failureCode: RuleBuildFailureCode }
  | { kind: "skipped" };

const ANALYSIS_STEP_RETRIES = {
  retries: {
    limit: 2,
    delay: "5 seconds" as const,
    backoff: "exponential" as const,
  },
  timeout: "10 minutes" as const,
} satisfies WorkflowStepConfig;

/**
 * Durable orchestration for one analysis run. The event payload is limited to
 * the three identity fields; every large or segmentable value lives in R2 (run
 * artifacts) or the vector index. The domain run marks FAILED itself for every
 * handled infrastructure failure; this workflow only falls back to a D1-only
 * terminal mark when the processing deps cannot be constructed at all (which
 * also keeps the run from blocking future begins forever).
 */
export class RulesAnalysisWorkflow extends WorkflowEntrypoint<
  Env,
  RulesAnalysisWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<RulesAnalysisWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<RulesAnalysisWorkflowResult> {
    const { analysisId, rulesAnalysisRunId } = event.payload;

    let deps: ReturnType<typeof createRulesAnalysisRunDeps>;
    try {
      deps = createRulesAnalysisRunDeps(this.env);
    } catch {
      await step.do("mark run unavailable", ANALYSIS_STEP_RETRIES, async () => {
        await createD1RulesAnalysisRunRepository(this.env.DB, {
          clock: systemClock,
        }).markFailedIfCurrent(
          rulesAnalysisRunId,
          "RULES_CONTEXT_STORAGE_UNAVAILABLE",
          systemClock.now(),
        );
      });
      return {
        kind: "failed",
        failureCode: "RULES_CONTEXT_STORAGE_UNAVAILABLE",
      };
    }

    const result = await step.do<RunRulesAnalysisRunResult>(
      "run rules analysis",
      ANALYSIS_STEP_RETRIES,
      () =>
        runRulesAnalysisRun({ analysisId, runId: rulesAnalysisRunId }, deps),
    );

    switch (result.kind) {
      case "completed":
        return { kind: "completed", status: result.status };
      case "failed":
        return { kind: "failed", failureCode: result.failureCode };
      case "not_current":
      case "rulebook_unavailable":
        return { kind: "skipped" };
    }
  }
}
