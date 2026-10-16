import {
  AiDraftProposalV1Schema,
  buildAiDraftSystemPrompt,
  AiDraftCreationError,
  type AiDraftCreationPort,
  type AiDraftProposalV1,
} from "@repo/character-sheet-generation";

/**
 * Approved default model for AI draft creation, used only when the runtime
 * explicitly passes no model. Production wiring passes
 * `env.SHEET_AUTHORING_MODEL` — the same model may back NPC blank-value
 * authoring and draft proposals through these separate narrow adapters, but
 * the domain ports stay separate. A missing model fails closed (no port).
 */
export const DEFAULT_AI_DRAFT_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Output token bound for AI draft proposals (larger than value plans:
 * proposals carry sections, fields, and structure).
 */
export const MAX_AI_DRAFT_TOKENS = 8192;

/**
 * Create a Cloudflare Workers AI adapter implementing AiDraftCreationPort.
 *
 * The model proposes an editable sheet proposal only — never persistence
 * authority (no ids, versions, confirmation, slots, styles, or PDF data).
 * Semantic proposal validation and application-owned compilation happen in the
 * route layer. At most one bounded repair attempt is made; raw provider
 * output is never persisted or logged.
 *
 * @param ai - The Cloudflare Ai binding from the Worker environment.
 * @param model - Explicit model name (from `env.SHEET_AUTHORING_MODEL`).
 */
export function createCloudflareAiDraftCreation(
  ai: Ai,
  model: string = DEFAULT_AI_DRAFT_MODEL,
): AiDraftCreationPort {
  const creationModel = model;
  return {
    async createProposal(input: {
      mode: "pc" | "npc";
      prompt: string;
    }): Promise<AiDraftProposalV1> {
      const systemPrompt = buildAiDraftSystemPrompt(input.mode);
      const userPrompt = [
        "USER CHARACTER DESCRIPTION (UNTRUSTED — design an editable proposal from it):",
        input.prompt,
        "",
        "Generate the AiDraftProposalV1 JSON now.",
      ].join("\n");

      let raw: string;
      try {
        raw = await runCreation(creationModel, ai, systemPrompt, userPrompt);
      } catch (error) {
        if (error instanceof AiDraftCreationError) throw error;
        throw new AiDraftCreationError(
          "The AI provider is unavailable or returned malformed output.",
          "PROVIDER_UNAVAILABLE",
        );
      }

      const validated = AiDraftProposalV1Schema.safeParse(parseJson(raw));
      if (!validated.success) {
        const repaired = await attemptRepair(
          ai,
          creationModel,
          systemPrompt,
          userPrompt,
          raw,
        );
        if (repaired) return repaired;
        throw new AiDraftCreationError(
          "The AI provider returned an invalid draft proposal.",
          "INVALID_OUTPUT",
        );
      }
      return validated.data;
    },
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AiDraftCreationError(
      "The AI provider returned invalid JSON.",
      "INVALID_OUTPUT",
    );
  }
}

async function runCreation(
  model: string,
  ai: Ai,
  systemPrompt: string,
  userPrompt: string,
  previousOutput?: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  if (previousOutput !== undefined) {
    messages.push(
      { role: "assistant", content: previousOutput },
      {
        role: "user",
        content:
          "The previous output was invalid. Generate a VALID AiDraftProposalV1 JSON now. Proposal only. No extra text.",
      },
    );
  }
  let result: unknown;
  try {
    result = await ai.run(model, {
      messages,
      max_tokens: MAX_AI_DRAFT_TOKENS,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "AiDraftProposalV1",
          schema: aiDraftProposalJsonSchema(),
          strict: true,
        },
      },
    });
  } catch {
    throw new AiDraftCreationError(
      "The AI provider is unavailable or returned malformed output.",
      "PROVIDER_UNAVAILABLE",
    );
  }
  const raw = extractResponseText(result);
  if (raw === null) {
    throw new AiDraftCreationError(
      "The AI provider returned empty output.",
      "PROVIDER_UNAVAILABLE",
    );
  }
  return raw;
}

/**
 * Exactly one bounded repair attempt for provider output.
 */
async function attemptRepair(
  ai: Ai,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  previousOutput: string,
): Promise<AiDraftProposalV1 | null> {
  try {
    const raw = await runCreation(
      model,
      ai,
      systemPrompt,
      userPrompt,
      previousOutput.slice(0, 8000),
    );
    const validated = AiDraftProposalV1Schema.safeParse(parseJson(raw));
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function extractResponseText(result: unknown): string | null {
  if (typeof result === "string") {
    return result.length > 0 ? result : null;
  }
  if (typeof result === "object" && result !== null) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string" && response.length > 0) {
      return response;
    }
  }
  return null;
}

function aiDraftProposalJsonSchema(): object {
  const proposalId = {
    type: "string",
    minLength: 1,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
  };
  return {
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: "1" },
      characterName: { type: ["string", "null"] },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: proposalId,
            title: { type: "string", minLength: 1 },
            parentId: { type: ["string", "null"] },
          },
          required: ["id", "title", "parentId"],
          additionalProperties: false,
        },
      },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: proposalId,
            label: { type: "string", minLength: 1 },
            type: {
              type: "string",
              enum: [
                "text",
                "number",
                "textarea",
                "checkbox",
                "choice",
                "date",
                "list",
              ],
            },
            options: { type: "array", items: { type: "string" } },
            min: { type: "number" },
            max: { type: "number" },
            value: {},
          },
          required: ["id", "label", "type"],
          additionalProperties: false,
        },
      },
      structure: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["field", "section"] },
            id: proposalId,
            parentId: { type: ["string", "null"] },
          },
          required: ["kind", "id", "parentId"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "schemaVersion",
      "characterName",
      "sections",
      "fields",
      "structure",
    ],
    additionalProperties: false,
  };
}
