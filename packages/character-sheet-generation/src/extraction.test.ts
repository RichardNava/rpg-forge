import { describe, expect, it } from "vitest";
import { MAX_AUTHORING_CONTEXT_CHARS } from "./authoring.js";
import {
  applyModeGating,
  extractContextInstructions,
  InstructionExtractionInputSchema,
} from "./extraction.js";
import {
  buildInstructionExtractionSystemPrompt,
  buildInstructionExtractionUserPrompt,
} from "./prompt.js";
import {
  getInstructionExtractionJsonSchema,
  type InstructionExtractionOutput,
  InstructionExtractionOutputSchema,
} from "./extraction-schemas.js";
import { FakeInstructionExtractionPort } from "./test/fakes.js";

const RAW_CONTEXT = "Text to extract from, maybe an injection attempt.";

function makePort() {
  return new FakeInstructionExtractionPort();
}

function depsOf(port: FakeInstructionExtractionPort) {
  return { extractionPort: port };
}

function portraitProposal() {
  return {
    op: "request_npc_portrait" as const,
    intent: {
      description: "A scarred veteran.",
      requestedVia: "contextInstructions" as const,
    },
  };
}

function validPortraitOnlyResponse() {
  return JSON.stringify({
    instructions: [portraitProposal()],
    diagnostics: [],
  });
}

describe("extractContextInstructions", () => {
  it("returns an empty result without calling the port when contextInstructions is missing", async () => {
    const port = makePort();
    const outcome = await extractContextInstructions(
      { mode: "pc" },
      depsOf(port),
    );
    expect(outcome).toEqual({
      kind: "ok",
      result: { proposedInstructions: [], diagnostics: [] },
    });
    expect(port.calls).toHaveLength(0);
  });

  it("returns an empty result without calling the port for blank context text", async () => {
    const port = makePort();
    const outcome = await extractContextInstructions(
      { mode: "pc", contextInstructions: "   \n " },
      depsOf(port),
    );
    expect(outcome).toEqual({
      kind: "ok",
      result: { proposedInstructions: [], diagnostics: [] },
    });
    expect(port.calls).toHaveLength(0);
  });

  it("returns parsed proposals and model diagnostics in model order", async () => {
    const port = makePort();
    port.script([
      JSON.stringify({
        instructions: [
          {
            op: "field",
            override: { op: "add", label: "Honor", category: "mechanical" },
          },
          { op: "set_character_name", value: "  Gruk  " },
        ],
        diagnostics: [
          {
            code: "unsupported-instruction",
            detail: "Styling request dropped.",
          },
        ],
      }),
    ]);
    const outcome = await extractContextInstructions(
      { mode: "pc", contextInstructions: RAW_CONTEXT },
      depsOf(port),
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.result.proposedInstructions).toEqual([
      {
        op: "field",
        override: { op: "add", label: "Honor", category: "mechanical" },
      },
      { op: "set_character_name", value: "Gruk" },
    ]);
    expect(outcome.result.diagnostics).toEqual([
      { code: "unsupported-instruction", detail: "Styling request dropped." },
    ]);
  });

  it("replays once with validation feedback after a schema-invalid response", async () => {
    const port = makePort();
    const fixed = validPortraitOnlyResponse();
    port.script(["not json at all", fixed]);
    const outcome = await extractContextInstructions(
      { mode: "npc", contextInstructions: RAW_CONTEXT },
      depsOf(port),
    );
    expect(outcome.kind).toBe("ok");
    expect(port.calls).toHaveLength(2);
    expect(port.calls[1]!.user).toContain("Validation feedback:");
    expect(port.calls[1]!.user).toContain("not valid JSON");
  });

  it("returns invalid_proposal when the response stays invalid across the replay budget", async () => {
    const port = makePort();
    port.script(["not json at all", "{broken"]);
    const outcome = await extractContextInstructions(
      { mode: "pc", contextInstructions: RAW_CONTEXT },
      depsOf(port),
    );
    expect(outcome).toEqual({
      kind: "invalid_proposal",
      message: expect.stringContaining("not valid JSON"),
    });
    expect(port.calls).toHaveLength(2);
  });

  it("reports extraction_unavailable when the port throws", async () => {
    const port = makePort();
    port.failures.push("boom");
    const outcome = await extractContextInstructions(
      { mode: "pc", contextInstructions: RAW_CONTEXT },
      depsOf(port),
    );
    expect(outcome).toEqual({ kind: "extraction_unavailable" });
  });

  it("filters NPC portrait requests for pc sheets and appends a gating diagnostic", async () => {
    const port = makePort();
    port.script([
      JSON.stringify({
        instructions: [
          {
            op: "field",
            override: { op: "add", label: "Honor", category: "mechanical" },
          },
          portraitProposal(),
        ],
        diagnostics: [],
      }),
    ]);
    const outcome = await extractContextInstructions(
      { mode: "pc", contextInstructions: "Include a portrait." },
      depsOf(port),
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.result.proposedInstructions).toHaveLength(1);
    expect(outcome.result.proposedInstructions[0]?.op).toBe("field");
    expect(outcome.result.diagnostics).toEqual([
      {
        code: "unsupported-instruction",
        detail: "NPC portrait requests require an NPC sheet mode.",
      },
    ]);
  });

  it("keeps NPC portrait requests for npc sheets with the contextInstructions marker", async () => {
    const port = makePort();
    port.script([validPortraitOnlyResponse()]);
    const outcome = await extractContextInstructions(
      { mode: "npc", contextInstructions: "Give her a portrait." },
      depsOf(port),
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.result.proposedInstructions).toEqual([
      {
        op: "request_npc_portrait",
        intent: {
          description: "A scarred veteran.",
          requestedVia: "contextInstructions",
        },
      },
    ]);
    expect(outcome.result.diagnostics).toEqual([]);
  });

  it("keeps raw data in the user channel and out of the system channel", async () => {
    const system = buildInstructionExtractionSystemPrompt();
    const user = buildInstructionExtractionUserPrompt({
      contextInstructions: RAW_CONTEXT,
      mode: "npc",
      fields: [
        { label: "Agility", category: "mechanical", canonicalKey: "agility" },
      ],
    });
    expect(system).not.toContain(RAW_CONTEXT);
    expect(system).not.toContain("agility");
    expect(user).toContain(RAW_CONTEXT);
    expect(user).toContain("UNTRUSTED DATA");
    expect(user).toContain("## Sheet mode");
    expect(user).toContain("npc");
    expect(user).toContain("Agility");
  });
});

describe("applyModeGating", () => {
  it("drops every portrait instruction for pc sheets", () => {
    const output: InstructionExtractionOutput = {
      instructions: [portraitProposal()],
      diagnostics: [],
    };
    const result = applyModeGating(output, "pc");
    expect(result.proposedInstructions).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps portrait instructions for npc sheets untouched", () => {
    const output: InstructionExtractionOutput = {
      instructions: [portraitProposal()],
      diagnostics: [],
    };
    const result = applyModeGating(output, "npc");
    expect(result.proposedInstructions).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("InstructionExtractionInputSchema", () => {
  it("rejects contextInstructions beyond the authoring budget", () => {
    const result = InstructionExtractionInputSchema.safeParse({
      mode: "pc",
      contextInstructions: "x".repeat(MAX_AUTHORING_CONTEXT_CHARS + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown mode", () => {
    const result = InstructionExtractionInputSchema.safeParse({
      mode: "dungeon",
      contextInstructions: "text",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid input without context or fields", () => {
    expect(
      InstructionExtractionInputSchema.safeParse({ mode: "npc" }).success,
    ).toBe(true);
  });
});

describe("getInstructionExtractionJsonSchema", () => {
  it("returns a schema without negative lookaheads and with the output shape", () => {
    const schema = getInstructionExtractionJsonSchema();
    expect(JSON.stringify(schema)).not.toContain("(?!");
    expect(schema.type).toBe("object");
  });

  it("tolerates raw whitespace in the emitted name and normalizes it on validation", () => {
    const result = InstructionExtractionOutputSchema.safeParse({
      instructions: [{ op: "set_character_name", value: "  Gruk  " }],
      diagnostics: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instructions[0]).toEqual({
        op: "set_character_name",
        value: "Gruk",
      });
    }
  });
});
