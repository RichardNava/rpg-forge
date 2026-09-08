import { describe, expect, it } from "vitest";
import {
  createCloudflareRulebookWorkflowPort,
  RulebookWorkflowUnavailableError,
} from "./rulebook-workflow.js";

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

describe("createCloudflareRulebookWorkflowPort", () => {
  it("start invokes workflow create with the ingestion id as the instance id", async () => {
    const binding = new StubWorkflowBinding();
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await port.start({
      analysisId: "analysis-1",
      ingestionId: "ingestion-1",
    } as never);
    expect(binding.created).toHaveLength(1);
    expect(binding.created[0]!.id).toBe("ingestion-1");
    expect(binding.created[0]!.params).toMatchObject({
      ingestionId: "ingestion-1",
    });
  });

  it("start fails closed when workflow create throws", async () => {
    const binding = new StubWorkflowBinding();
    binding.createError = new Error("boom");
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await expect(
      port.start({ analysisId: "a", ingestionId: "i" } as never),
    ).rejects.toBeInstanceOf(RulebookWorkflowUnavailableError);
  });

  it("terminate ignores an already-complete instance to keep DELETE idempotent", async () => {
    const binding = new StubWorkflowBinding();
    binding.statusFor["i"] = "complete";
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await port.terminate("i");
    expect(binding.terminatedInstances).toHaveLength(0);
  });

  it("terminate ignores an errored or terminated instance", async () => {
    for (const status of ["errored", "terminated"]) {
      const binding = new StubWorkflowBinding();
      binding.statusFor["i"] = status as StubStatus;
      const port = createCloudflareRulebookWorkflowPort(
        binding as unknown as Workflow<{
          analysisId: string;
          ingestionId: string;
        }>,
      );
      await port.terminate("i");
      expect(binding.terminatedInstances).toHaveLength(0);
    }
  });

  it("terminate calls terminate for a running instance", async () => {
    const binding = new StubWorkflowBinding();
    binding.statusFor["i"] = "running";
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await port.terminate("i");
    expect(binding.terminatedInstances).toEqual(["i"]);
  });

  it("terminate swallows a missing workflow instance as idempotent", async () => {
    const binding = new StubWorkflowBinding();
    binding.terminateError = new Error("Workflow instance not found");
    binding.statusFor["i"] = "running";
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await expect(port.terminate("i")).resolves.toBeUndefined();
  });

  it("terminate fails closed when the instance is unknown", async () => {
    const binding = new StubWorkflowBinding();
    binding.statusFor["i"] = "unknown";
    const port = createCloudflareRulebookWorkflowPort(
      binding as unknown as Workflow<{
        analysisId: string;
        ingestionId: string;
      }>,
    );
    await expect(port.terminate("i")).rejects.toBeInstanceOf(
      RulebookWorkflowUnavailableError,
    );
  });
});
