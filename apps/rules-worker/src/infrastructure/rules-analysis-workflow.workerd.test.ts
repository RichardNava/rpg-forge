import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1RulesAnalysisRunRepository } from "./db/run-repository.js";
import { RulesAnalysisWorkflow } from "../rules-analysis-workflow.js";
import {
  createCloudflareRulesAnalysisWorkflowPort,
  RulesAnalysisWorkflowUnavailableError,
  type RulesAnalysisWorkflowStartInput,
} from "./rules-analysis-workflow.js";

const MIGRATION_DDL =
  'CREATE TABLE `rules_analysis_runs` (`run_id` text PRIMARY KEY NOT NULL, `analysis_id` text NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`); CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`); CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`); CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;';

type StubStatus =
  | "queued"
  | "running"
  | "paused"
  | "complete"
  | "errored"
  | "terminated"
  | "unknown";

class StubWorkflowBinding {
  readonly created: Array<{ id: string; params: unknown }> = [];
  readonly terminatedInstances: string[] = [];
  statusFor: Record<string, StubStatus> = {};
  statusError: Error | undefined;
  terminateError: Error | undefined;
  createError: Error | undefined;

  async create(input: {
    id: string;
    params: unknown;
  }): Promise<{ id: string }> {
    if (this.createError) throw this.createError;
    this.created.push(input);
    return { id: input.id };
  }

  async get(id: string): Promise<{
    status(): Promise<{ status: StubStatus }>;
    terminate(): Promise<void>;
  }> {
    if (this.statusError) throw this.statusError;
    const status = this.statusFor[id] ?? "queued";
    return {
      status: async () => ({ status }),
      terminate: async () => {
        if (this.terminateError) throw this.terminateError;
        this.terminatedInstances.push(id);
      },
    };
  }
}

function makeInput(overrides: Partial<RulesAnalysisWorkflowStartInput> = {}) {
  return {
    analysisId: crypto.randomUUID(),
    ingestionId: crypto.randomUUID(),
    rulesAnalysisRunId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("createCloudflareRulesAnalysisWorkflowPort", () => {
  it("start invokes create with the run id as the instance id", async () => {
    const binding = new StubWorkflowBinding();
    const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
    const input = makeInput();
    await port.start(input);
    expect(binding.created).toHaveLength(1);
    expect(binding.created[0]?.id).toBe(input.rulesAnalysisRunId);
    expect(binding.created[0]?.params).toEqual(input);
  });

  it("start treats an already-existing instance as idempotent", async () => {
    for (const message of [
      "Workflow instance already exists",
      "instance already created: abc",
    ]) {
      const binding = new StubWorkflowBinding();
      binding.createError = new Error(message);
      const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
      await expect(port.start(makeInput())).resolves.toBeUndefined();
      expect(binding.created).toHaveLength(0);
    }
  });

  it("start fails closed on an unexpected create failure", async () => {
    const binding = new StubWorkflowBinding();
    binding.createError = new Error("boom");
    const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
    await expect(port.start(makeInput())).rejects.toBeInstanceOf(
      RulesAnalysisWorkflowUnavailableError,
    );
  });

  it("terminate ignores a terminal instance to keep invalidation idempotent", async () => {
    for (const status of ["complete", "errored", "terminated"]) {
      const binding = new StubWorkflowBinding();
      binding.statusFor["r"] = status as StubStatus;
      const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
      await port.terminate("r");
      expect(binding.terminatedInstances).toHaveLength(0);
    }
  });

  it("terminate calls terminate for a queued or running instance", async () => {
    for (const status of ["queued", "running"]) {
      const binding = new StubWorkflowBinding();
      binding.statusFor["r"] = status as StubStatus;
      const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
      await port.terminate("r");
      expect(binding.terminatedInstances).toEqual(["r"]);
    }
  });

  it("terminate swallows a missing workflow instance as idempotent", async () => {
    const binding = new StubWorkflowBinding();
    binding.terminateError = new Error("Workflow instance not found");
    binding.statusFor["r"] = "running";
    const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
    await expect(port.terminate("r")).resolves.toBeUndefined();
  });

  it("terminate fails closed when the instance is unknown", async () => {
    const binding = new StubWorkflowBinding();
    binding.statusFor["r"] = "unknown";
    const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
    await expect(port.terminate("r")).rejects.toBeInstanceOf(
      RulesAnalysisWorkflowUnavailableError,
    );
  });

  it("terminate fails closed when the status call itself fails", async () => {
    const binding = new StubWorkflowBinding();
    binding.statusError = new Error("workflow down");
    const port = createCloudflareRulesAnalysisWorkflowPort(binding as never);
    await expect(port.terminate("r")).rejects.toBeInstanceOf(
      RulesAnalysisWorkflowUnavailableError,
    );
  });
});

describe("RulesAnalysisWorkflow", () => {
  it("marks the current run FAILED via D1 when processing deps cannot be constructed", async () => {
    const db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
    const repository = createD1RulesAnalysisRunRepository(db, {
      clock: { now: () => new Date("2026-09-07T10:00:00.000Z") },
    });
    const run = {
      runId: crypto.randomUUID(),
      analysisId: crypto.randomUUID(),
      ingestionId: crypto.randomUUID(),
      status: "QUEUED" as const,
      failureCode: null,
      isCurrent: true,
      createdAt: new Date("2026-09-07T10:00:00.000Z"),
      updatedAt: new Date("2026-09-07T10:00:00.000Z"),
    };
    await repository.createCurrent(run);

    const stepNames: string[] = [];
    const step = {
      do: async (
        _name: string,
        _config: unknown,
        fn: () => Promise<unknown>,
      ) => {
        stepNames.push(_name);
        return fn();
      },
    } as never;

    const workflow = Object.create(
      RulesAnalysisWorkflow.prototype,
    ) as RulesAnalysisWorkflow;
    Object.defineProperty(workflow, "env", {
      value: { DB: db, RULEBOOK_BUCKET: undefined },
    });
    const result = await workflow.run(
      {
        payload: {
          analysisId: run.analysisId,
          ingestionId: run.ingestionId,
          rulesAnalysisRunId: run.runId,
        },
      } as never,
      step,
    );

    expect(result).toEqual({
      kind: "failed",
      failureCode: "RULES_CONTEXT_STORAGE_UNAVAILABLE",
    });
    expect(stepNames).toEqual(["mark run unavailable"]);
    const marked = await repository.findRun(run.analysisId, run.runId);
    expect(marked?.status).toBe("FAILED");
    expect(marked?.failureCode).toBe("RULES_CONTEXT_STORAGE_UNAVAILABLE");
  });
});
