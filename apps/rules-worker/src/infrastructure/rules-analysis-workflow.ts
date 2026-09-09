import type { RulesAnalysisWorkflowParams } from "../rules-analysis-workflow.js";

export class RulesAnalysisWorkflowUnavailableError extends Error {
  constructor() {
    super("The rules analysis workflow is unavailable.");
    this.name = "RulesAnalysisWorkflowUnavailableError";
  }
}

export interface RulesAnalysisWorkflowStartInput {
  analysisId: string;
  ingestionId: string;
  rulesAnalysisRunId: string;
}

export interface RulesAnalysisWorkflowPort {
  start(input: RulesAnalysisWorkflowStartInput): Promise<void>;
  terminate(rulesAnalysisRunId: string): Promise<void>;
}

export function createCloudflareRulesAnalysisWorkflowPort(
  workflow: Workflow<RulesAnalysisWorkflowParams>,
): RulesAnalysisWorkflowPort {
  return {
    async start(input): Promise<void> {
      try {
        await workflow.create({ id: input.rulesAnalysisRunId, params: input });
      } catch (error) {
        if (isWorkflowInstanceExists(error)) {
          return;
        }
        throw new RulesAnalysisWorkflowUnavailableError();
      }
    },

    async terminate(rulesAnalysisRunId: string): Promise<void> {
      try {
        const instance = await workflow.get(rulesAnalysisRunId);
        const state = await instance.status();
        if (
          state.status === "complete" ||
          state.status === "errored" ||
          state.status === "terminated"
        ) {
          return;
        }
        if (state.status === "unknown") {
          throw new RulesAnalysisWorkflowUnavailableError();
        }
        await instance.terminate();
      } catch (error) {
        if (isWorkflowInstanceMissing(error)) {
          return;
        }
        if (error instanceof RulesAnalysisWorkflowUnavailableError) {
          throw error;
        }
        throw new RulesAnalysisWorkflowUnavailableError();
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

function isWorkflowInstanceExists(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /already exists|already created/i.test(error.message);
}
