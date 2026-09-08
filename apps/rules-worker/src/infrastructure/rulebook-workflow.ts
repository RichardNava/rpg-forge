import type {
  RulebookProcessingWorkflowPort,
  RulebookWorkflowParams,
} from "@repo/rulebook-ingestion";

export class RulebookWorkflowUnavailableError extends Error {
  constructor() {
    super("Rulebook processing workflow is unavailable.");
    this.name = "RulebookWorkflowUnavailableError";
  }
}

export function createCloudflareRulebookWorkflowPort(
  workflow: Workflow<RulebookWorkflowParams>,
): RulebookProcessingWorkflowPort {
  return {
    async start(input): Promise<void> {
      try {
        await workflow.create({ id: input.ingestionId, params: input });
      } catch {
        throw new RulebookWorkflowUnavailableError();
      }
    },

    async terminate(ingestionId: string): Promise<void> {
      try {
        const instance = await workflow.get(ingestionId);
        const state = await instance.status();
        if (
          state.status === "complete" ||
          state.status === "errored" ||
          state.status === "terminated"
        ) {
          return;
        }
        if (state.status === "unknown") {
          throw new RulebookWorkflowUnavailableError();
        }
        await instance.terminate();
      } catch (error) {
        if (isWorkflowInstanceMissing(error)) {
          return;
        }
        if (error instanceof RulebookWorkflowUnavailableError) {
          throw error;
        }
        throw new RulebookWorkflowUnavailableError();
      }
    },
  };
}

function isWorkflowInstanceMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /not found|does not exist/i.test(error.message);
}
