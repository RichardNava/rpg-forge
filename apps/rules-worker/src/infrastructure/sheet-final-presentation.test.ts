import { describe, expect, it } from "vitest";
import {
  createCloudflareAiFinalPresentation,
  DEFAULT_FINAL_PRESENTATION_MODEL,
  MAX_PRESENTATION_PLAN_TOKENS,
} from "./sheet-final-presentation.js";
import { FinalPresentationError } from "./ai-errors.js";

interface FakeAi {
  readonly calls: Array<{ model: string; input: unknown }>;
  result: unknown;
  error?: Error;
}

function fakeAi(result: unknown): FakeAi {
  return { calls: [], result };
}

function handlerOf(ai: FakeAi) {
  return {
    async run(model: string, input: unknown) {
      ai.calls.push({ model, input });
      if (ai.error !== undefined) {
        throw ai.error;
      }
      return ai.result;
    },
  } as unknown as Ai;
}

const VALID_PLAN = JSON.stringify({
  schemaVersion: "1",
  style: "medieval",
  variant: "standard",
  ornamentDensity: "light",
  contrast: "medium",
  sectionEmphasis: "standard",
  fieldEmphasis: "standard",
});

const SUMMARY = {
  mode: "pc" as const,
  fieldCount: 3,
  sectionCount: 1,
  maxNestingDepth: 1,
  rootColumns: 1,
  hasLayout: false,
  density: "sparse" as const,
};

describe("createCloudflareAiFinalPresentation", () => {
  it("passes the explicitly configured model to ai.run()", async () => {
    const ai = fakeAi({ response: VALID_PLAN });
    const port = createCloudflareAiFinalPresentation(
      handlerOf(ai),
      "custom-presentation-model",
    );
    const plan = await port.generatePlan("medieval", SUMMARY, null);
    expect(plan.style).toBe("medieval");
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.model).toBe("custom-presentation-model");
  });

  it("uses the approved default model when none is configured", async () => {
    const ai = fakeAi({ response: VALID_PLAN });
    const port = createCloudflareAiFinalPresentation(handlerOf(ai));
    await port.generatePlan("medieval", SUMMARY, null);
    expect(ai.calls[0]?.model).toBe(DEFAULT_FINAL_PRESENTATION_MODEL);
  });

  it("sends role-separated system/user messages with restrained settings", async () => {
    const ai = fakeAi({ response: VALID_PLAN });
    const port = createCloudflareAiFinalPresentation(handlerOf(ai), "m");
    await port.generatePlan("medieval", SUMMARY, "Keep it restrained.");
    const input = ai.calls[0]?.input as Record<string, unknown>;
    const messages = input.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Keep it restrained.");
    expect(input.temperature).toBe(0);
    expect(input.max_tokens).toBe(MAX_PRESENTATION_PLAN_TOKENS);
    expect(input.response_format).toMatchObject({ type: "json_schema" });
    expect("tools" in input).toBe(false);
  });

  it("rejects an unsupported style without calling the provider", async () => {
    const ai = fakeAi({ response: VALID_PLAN });
    const port = createCloudflareAiFinalPresentation(handlerOf(ai), "m");
    await expect(
      port.generatePlan("fantasy" as never, SUMMARY, null),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_STYLE" });
    expect(ai.calls).toHaveLength(0);
  });

  it("maps provider failure to PROVIDER_UNAVAILABLE", async () => {
    const ai = fakeAi(null);
    ai.error = new Error("down");
    const port = createCloudflareAiFinalPresentation(handlerOf(ai), "m");
    await expect(port.generatePlan("medieval", SUMMARY, null)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(ai).toBeDefined();
    expect(FinalPresentationError).toBeDefined();
  });
});
