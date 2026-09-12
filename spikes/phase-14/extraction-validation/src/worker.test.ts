import { describe, expect, it } from "vitest";
import type { Ai } from "@cloudflare/workers-types";
import {
  MAX_EXTRACTION_VALIDATION_OUTPUT_TOKENS,
  AUTHORIZED_MODEL,
} from "../config.js";
import { handleExtract } from "./worker.js";

interface CapturedRun {
  model: unknown;
  params: unknown;
}

function fakeAi(runResult: (capture: CapturedRun) => unknown): {
  readonly ai: Ai;
  readonly capture: CapturedRun;
} {
  const capture: CapturedRun = { model: undefined, params: undefined };
  const ai = {
    async run(model: unknown, params: unknown): Promise<unknown> {
      capture.model = model;
      capture.params = params;
      return runResult(capture);
    },
  } as unknown as Ai;
  return { ai, capture };
}

function post(body: unknown, ai: Ai): Promise<Response> {
  return handleExtract(
    new Request("http://127.0.0.1/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { AI: ai },
  );
}

describe("extraction-validation shim worker", () => {
  it("pins the authorized model and output cap", () => {
    expect(AUTHORIZED_MODEL).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(MAX_EXTRACTION_VALIDATION_OUTPUT_TOKENS).toBe(2048);
  });

  it("rejects a body without the required fields", async () => {
    const { ai } = fakeAi(() => ({}));
    const response = await post({}, ai);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });

  it("rejects a missing AI binding", async () => {
    const response = await handleExtract(
      new Request("http://127.0.0.1/extract", { method: "POST" }),
      { AI: undefined } as unknown as { AI: Ai },
    );
    expect(response.status).toBe(500);
  });

  it("rejects a non-object schema", async () => {
    const { ai } = fakeAi(() => ({}));
    const response = await post(
      { model: AUTHORIZED_MODEL, system: "s", user: "u", schema: "nope" },
      ai,
    );
    expect(response.status).toBe(400);
  });

  it("forwards messages, max_tokens and the json_schema response_format", async () => {
    const expectedText = '{"instructions":[],"diagnostics":[]}';
    const usage = { input_tokens: 10, output_tokens: 4 };
    const runResult = () => ({
      response: expectedText,
      finish_reason: "stop",
      usage,
    });
    const { ai, capture } = fakeAi(runResult);

    const response = await post(
      {
        model: AUTHORIZED_MODEL,
        system: "system prompt",
        user: "user prompt",
        schema: { type: "object" },
      },
      ai,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success?: unknown;
      text?: unknown;
      finishReason?: unknown;
      usage?: unknown;
      elapsedMs?: unknown;
    };
    expect(body.success).toBe(true);
    expect(body.text).toBe(expectedText);
    expect(body.finishReason).toBe("stop");
    expect(body.usage).toEqual(usage);
    expect(capture.model).toBe(AUTHORIZED_MODEL);

    const params = capture.params as {
      messages?: { role: string; content: string }[];
      max_tokens?: unknown;
      response_format?: { type?: unknown; json_schema?: unknown };
    };
    expect(params.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    expect(params.max_tokens).toBe(MAX_EXTRACTION_VALIDATION_OUTPUT_TOKENS);
    expect(params.response_format).toEqual({
      type: "json_schema",
      json_schema: { type: "object" },
    });
  });

  it("returns a 500 when the provider result carries no usable text", async () => {
    const { ai } = fakeAi(() => ({}));
    const response = await post(
      {
        model: AUTHORIZED_MODEL,
        system: "s",
        user: "u",
        schema: { type: "object" },
      },
      ai,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      success?: unknown;
      error?: unknown;
    };
    expect(body.success).toBe(false);
    expect(body.error).toContain("No usable text");
  });

  it("surfaces provider exceptions with name and message", async () => {
    const { ai } = fakeAi(() => {
      throw new Error("quota exceeded");
    });
    const response = await post(
      {
        model: AUTHORIZED_MODEL,
        system: "s",
        user: "u",
        schema: { type: "object" },
      },
      ai,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      errorName?: unknown;
      errorMessage?: unknown;
    };
    expect(body.errorName).toBe("Error");
    expect(body.errorMessage).toBe("quota exceeded");
  });
});
