import type { Ai } from "@cloudflare/workers-types";

export interface Env {
  readonly AI: Ai;
}

const SINGLE_TEST_SENTENCE = "Armor reduces physical damage.";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/ai/embed") {
      return handleEmbedBatch(request, env);
    }

    if (request.method === "POST" && url.pathname === "/ai/generate") {
      return handleGenerate(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

async function handleEmbedBatch(request: Request, env: Env): Promise<Response> {
  if (env.AI === undefined || env.AI === null) {
    return Response.json(
      { success: false, error: "env.AI is not available" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    readonly model?: unknown;
    readonly texts?: unknown;
  } | null;

  if (
    typeof body?.model !== "string" ||
    body.model.length === 0 ||
    !Array.isArray(body.texts) ||
    body.texts.length === 0
  ) {
    return Response.json(
      { success: false, error: "Provide { model: string, texts: string[] }" },
      { status: 400 },
    );
  }

  const model = body.model;
  const texts: string[] = body.texts.filter(
    (t): t is string => typeof t === "string",
  );

  if (texts.length === 0) {
    return Response.json(
      { success: false, error: "texts array must contain non-empty strings" },
      { status: 400 },
    );
  }

  const startedAt = performance.now();

  try {
    const result = await env.AI.run(model, { text: texts });
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

    const data = result as unknown as {
      readonly data?: readonly (readonly number[])[];
      readonly shape?: readonly number[];
    };

    return Response.json({
      success: true,
      model,
      textCount: texts.length,
      dimensions: data.data?.[0]?.length ?? data.shape?.[1] ?? 0,
      elapsedMs,
      data: data.data,
    });
  } catch (error) {
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "Unknown";

    return Response.json(
      {
        success: false,
        model,
        elapsedMs,
        errorName: name,
        errorMessage: message,
      },
      { status: 500 },
    );
  }
}

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  if (env.AI === undefined || env.AI === null) {
    return Response.json(
      { success: false, error: "env.AI is not available" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    readonly model?: unknown;
    readonly prompt?: unknown;
    readonly jsonMode?: unknown;
    readonly jsonSchema?: unknown;
  } | null;

  if (
    typeof body?.model !== "string" ||
    body.model.length === 0 ||
    typeof body?.prompt !== "string" ||
    body.prompt.length === 0
  ) {
    return Response.json(
      {
        success: false,
        error:
          "Provide { model: string, prompt: string, jsonMode?: boolean, jsonSchema?: object }",
      },
      { status: 400 },
    );
  }

  const model = body.model;
  const prompt = body.prompt;
  const jsonMode = body.jsonMode === true;
  const jsonSchema =
    typeof body.jsonSchema === "object" && body.jsonSchema !== null
      ? body.jsonSchema
      : undefined;

  const startedAt = performance.now();

  try {
    const runInput: Record<string, unknown> = { prompt };
    if (jsonSchema !== undefined) {
      runInput.response_format = {
        type: "json_schema",
        json_schema: jsonSchema,
      };
    } else if (jsonMode) {
      runInput.response_format = { type: "json_object" };
    }

    const result = await env.AI.run(model, runInput);
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

    const data = result as unknown as {
      readonly response?: unknown;
      readonly choices?: readonly { readonly text?: unknown }[];
    };

    let text: string;
    if (typeof data.response === "string") {
      text = data.response;
    } else if (typeof data.response === "object" && data.response !== null) {
      text = JSON.stringify(data.response);
    } else if (Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      text = typeof choice?.text === "string" ? choice.text : "";
    } else {
      text = JSON.stringify(result);
    }

    return Response.json({
      success: true,
      model,
      jsonMode,
      textLength: text.length,
      elapsedMs,
      text,
    });
  } catch (error) {
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "Unknown";

    return Response.json(
      {
        success: false,
        model,
        elapsedMs,
        errorName: name,
        errorMessage: message,
      },
      { status: 500 },
    );
  }
}
