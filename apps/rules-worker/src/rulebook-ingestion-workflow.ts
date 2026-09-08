import {
  finalizeRulebookReady,
  processRulebook,
  recordTerminalRulebookFailure,
  type ProcessRulebookResult,
  type RulebookWorkflowParams,
} from "@repo/rulebook-ingestion";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStepConfig,
  type WorkflowStep,
} from "cloudflare:workers";
import { createRulebookProcessingDeps } from "./deps.js";
import type { Env } from "./env.js";

const TRANSIENT_STEP_RETRIES = {
  retries: {
    limit: 2,
    delay: "5 seconds" as const,
    backoff: "exponential" as const,
  },
  timeout: "10 minutes" as const,
} satisfies WorkflowStepConfig;

/**
 * Durable orchestration only. R2 carries all large artifacts; workflow events
 * and step outputs contain only the parent id, generation id, and metadata.
 */
export class RulebookIngestionWorkflow extends WorkflowEntrypoint<
  Env,
  RulebookWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<RulebookWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<{ kind: "ready" | "failed" | "skipped" }> {
    const deps = createRulebookProcessingDeps(this.env);
    let processing: ProcessRulebookResult;
    try {
      processing = await step.do<ProcessRulebookResult>(
        "process rulebook",
        TRANSIENT_STEP_RETRIES,
        async () => processRulebook(event.payload, deps),
      );
    } catch {
      await step.do(
        "record processing failure",
        TRANSIENT_STEP_RETRIES,
        async () =>
          recordTerminalRulebookFailure(
            {
              ...event.payload,
              failureCode: "RULEBOOK_PROCESSING_FAILED",
            },
            deps,
          ),
      );
      return { kind: "failed" };
    }

    if (processing.kind === "skipped") {
      return { kind: "skipped" };
    }
    if (processing.kind === "terminal_failure") {
      await step.do(
        "record terminal rulebook failure",
        TRANSIENT_STEP_RETRIES,
        async () =>
          recordTerminalRulebookFailure(
            {
              ...event.payload,
              failureCode: processing.failureCode,
            },
            deps,
          ),
      );
      return { kind: "failed" };
    }

    const finalized = await step.do<"ready" | "skipped">(
      "finalize rulebook ready",
      TRANSIENT_STEP_RETRIES,
      async () =>
        finalizeRulebookReady(
          { ...event.payload, ...processing },
          {
            clock: deps.clock,
            sessionRepository: deps.sessionRepository,
            repository: deps.repository,
          },
        ),
    );
    return finalized === "ready" ? { kind: "ready" } : { kind: "skipped" };
  }
}
