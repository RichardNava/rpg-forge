import { describe, expect, it, vi } from "vitest";
import { AiDraftCreationError } from "@repo/character-sheet-generation";
import {
  createCloudflareAiDraftCreation,
  DEFAULT_AI_DRAFT_MODEL,
} from "./sheet-ai-draft-creation.js";

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

const VALID_PROPOSAL = JSON.stringify({
  schemaVersion: "1",
  characterName: "Grom",
  sections: [{ id: "core", title: "Core", parentId: null }],
  fields: [
    { id: "character_name", label: "Character name", type: "text" },
    { id: "strength", label: "Strength", type: "number", min: 1, max: 10 },
  ],
  structure: [
    { kind: "field", id: "character_name", parentId: null },
    { kind: "section", id: "core", parentId: null },
    { kind: "field", id: "strength", parentId: "core" },
  ],
});

describe("createCloudflareAiDraftCreation", () => {
  it("passes the explicitly configured model and fixed mode", async () => {
    const { ai, calls } = fakeAi({ response: VALID_PROPOSAL });
    const port = createCloudflareAiDraftCreation(ai, "custom-authoring-model");
    const proposal = await port.createProposal({
      mode: "npc",
      prompt: "A large orc.",
    });
    expect(proposal.characterName).toBe("Grom");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("custom-authoring-model");
    const input = calls[0]?.input as Record<string, unknown>;
    expect(input["temperature"]).toBe(0);
    const messages = input["messages"] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("FIXED MODE: npc");
    expect(messages[1]?.content).toContain("A large orc.");
  });

  it("uses the approved default model when none is configured", async () => {
    const { ai, calls } = fakeAi({ response: VALID_PROPOSAL });
    await createCloudflareAiDraftCreation(ai).createProposal({
      mode: "pc",
      prompt: "A scout.",
    });
    expect(calls[0]?.model).toBe(DEFAULT_AI_DRAFT_MODEL);
  });

  const SCHEMA_INVALID = JSON.stringify({
    schemaVersion: "1",
    characterName: null,
    sections: [],
    fields: [],
    structure: [],
  });

  it("repairs once, then fails (no retry loop)", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: SCHEMA_INVALID })
      .mockResolvedValueOnce({ response: VALID_PROPOSAL });
    const port = createCloudflareAiDraftCreation({ run } as unknown as Ai, "m");
    const proposal = await port.createProposal({ mode: "pc", prompt: "x" });
    expect(proposal.fields).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockResolvedValue({ response: SCHEMA_INVALID });
    const failingPort = createCloudflareAiDraftCreation(
      { run: failing } as unknown as Ai,
      "m",
    );
    await expect(
      failingPort.createProposal({ mode: "pc", prompt: "x" }),
    ).rejects.toBeInstanceOf(AiDraftCreationError);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("maps provider failure to PROVIDER_UNAVAILABLE", async () => {
    const { ai } = fakeAi(null, new Error("down"));
    const port = createCloudflareAiDraftCreation(ai, "m");
    const error = await port
      .createProposal({ mode: "pc", prompt: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiDraftCreationError);
    expect((error as AiDraftCreationError).code).toBe("PROVIDER_UNAVAILABLE");
  });
});
