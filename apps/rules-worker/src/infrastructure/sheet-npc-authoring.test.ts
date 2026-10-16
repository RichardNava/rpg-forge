import { describe, expect, it, vi } from "vitest";
import { NpcAuthoringError } from "@repo/character-sheet-generation";
import {
  createCloudflareAiNpcAuthoring,
  DEFAULT_NPC_AUTHORING_MODEL,
} from "./sheet-npc-authoring.js";

function fakeAi(result: unknown, error?: Error) {
  const calls: Array<{ model: string; input: unknown }> = [];
  const ai = {
    async run(model: string, input: unknown) {
      calls.push({ model, input });
      if (error !== undefined) throw error;
      return result;
    },
  } as unknown as Ai;
  return { ai, calls };
}

const INPUT = {
  blanks: [
    {
      key: "strength",
      label: "Strength",
      type: "number" as const,
      min: 1,
      max: 10,
    },
    { key: "bio", label: "Biography", type: "textarea" as const },
  ],
  explicit: [{ key: "title", label: "Title", type: "text", value: "Grom" }],
  npcInstructions: "Big and clumsy.",
  threat: "medium" as const,
  seed: "seed-1",
};

const VALID_PLAN = JSON.stringify({
  schemaVersion: "1",
  assignments: [
    { key: "strength", value: 8 },
    { key: "bio", value: "Large and clumsy." },
  ],
});

describe("createCloudflareAiNpcAuthoring", () => {
  it("passes the explicitly configured model and restrained settings", async () => {
    const { ai, calls } = fakeAi({ response: VALID_PLAN });
    const port = createCloudflareAiNpcAuthoring(ai, "custom-authoring-model");
    const plan = await port.generateAssignments(INPUT);
    expect(plan.assignments).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("custom-authoring-model");
    const input = calls[0]?.input as Record<string, unknown>;
    expect(input["temperature"]).toBe(0);
    expect(input["max_tokens"]).toBe(4096);
    const messages = input["messages"] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Big and clumsy.");
    expect(messages[1]?.content).toContain("Grom");
  });

  it("uses the approved default model when none is configured", async () => {
    const { ai, calls } = fakeAi({ response: VALID_PLAN });
    await createCloudflareAiNpcAuthoring(ai).generateAssignments(INPUT);
    expect(calls[0]?.model).toBe(DEFAULT_NPC_AUTHORING_MODEL);
  });

  it("never sends visual style to the content model", async () => {
    const { ai, calls } = fakeAi({ response: VALID_PLAN });
    await createCloudflareAiNpcAuthoring(ai, "m").generateAssignments(INPUT);
    const input = calls[0]?.input as Record<string, unknown>;
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("medieval");
    expect(serialized).not.toContain("sci-fi");
  });

  const SCHEMA_INVALID = JSON.stringify({
    schemaVersion: "1",
    assignments: [{ key: "strength", value: 8 }],
    css: "body{display:none}",
  });

  it("repairs once on schema-invalid output, then fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: SCHEMA_INVALID })
      .mockResolvedValueOnce({ response: VALID_PLAN });
    const port = createCloudflareAiNpcAuthoring({ run } as unknown as Ai, "m");
    const plan = await port.generateAssignments(INPUT);
    expect(plan.assignments).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails after a single repair attempt (no retry loop)", async () => {
    const run = vi.fn().mockResolvedValue({ response: SCHEMA_INVALID });
    const port = createCloudflareAiNpcAuthoring({ run } as unknown as Ai, "m");
    await expect(port.generateAssignments(INPUT)).rejects.toBeInstanceOf(
      NpcAuthoringError,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects non-JSON output without repair", async () => {
    const run = vi.fn().mockResolvedValue({ response: "not-json" });
    const port = createCloudflareAiNpcAuthoring({ run } as unknown as Ai, "m");
    await expect(port.generateAssignments(INPUT)).rejects.toBeInstanceOf(
      NpcAuthoringError,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("maps provider failure to PROVIDER_UNAVAILABLE", async () => {
    const { ai } = fakeAi(null, new Error("down"));
    const port = createCloudflareAiNpcAuthoring(ai, "m");
    const error = await port
      .generateAssignments(INPUT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NpcAuthoringError);
    expect((error as NpcAuthoringError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("rejects adversarial assignments structurally (extra properties)", async () => {
    const { ai } = fakeAi({
      response: JSON.stringify({
        schemaVersion: "1",
        assignments: [{ key: "strength", value: 8 }],
        css: "body{display:none}",
      }),
    });
    const port = createCloudflareAiNpcAuthoring(ai, "m");
    await expect(port.generateAssignments(INPUT)).rejects.toBeInstanceOf(
      NpcAuthoringError,
    );
  });
});
