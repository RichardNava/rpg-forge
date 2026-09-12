import type { Ai } from "@cloudflare/workers-types";
import {
  extractFinishReason,
  extractResponseText,
  extractUsage,
  getSchemaForStage,
  isSheetGenerationStage,
  MAX_SHEET_BENCH_OUTPUT_TOKENS,
} from "./stage-config.js";

export interface Env {
  readonly AI: Ai;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/sheets/generate") {
      return handleSheetGenerate(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

async function handleSheetGenerate(
  request: Request,
  env: Env,
): Promise<Response> {
  if (env.AI === undefined || env.AI === null) {
    return Response.json(
      { success: false, error: "env.AI is not available" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    readonly model?: unknown;
    readonly stage?: unknown;
    readonly system?: unknown;
    readonly user?: unknown;
    readonly persona?: unknown;
  } | null;

  if (
    typeof body?.model !== "string" ||
    body.model.length === 0 ||
    !isSheetGenerationStage(body.stage) ||
    typeof body?.system !== "string" ||
    body.system.length === 0 ||
    typeof body?.user !== "string" ||
    body.user.length === 0
  ) {
    return Response.json(
      {
        success: false,
        error:
          "Provide { model: string, stage: section-plan|field-candidates|calculations, system: string, user: string, persona?: string }",
      },
      { status: 400 },
    );
  }

  const model = body.model;
  const stage = body.stage;
  const system = body.system;
  const user = body.user;
  const persona =
    typeof body.persona === "string" && body.persona.length > 0
      ? body.persona
      : null;

  const startedAt = performance.now();

  try {
    const schema = getSchemaForStage(stage, persona);
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: MAX_SHEET_BENCH_OUTPUT_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: schema,
      },
    });
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

    const text = extractResponseText(result);
    if (text === null) {
      return Response.json(
        {
          success: false,
          model,
          stage,
          elapsedMs,
          error: "No usable text in provider result",
        },
        { status: 500 },
      );
    }

    return Response.json({
      success: true,
      model,
      stage,
      textLength: text.length,
      elapsedMs,
      finishReason: extractFinishReason(result),
      usage: extractUsage(result),
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
        stage,
        elapsedMs,
        errorName: name,
        errorMessage: message,
      },
      { status: 500 },
    );
  }
}
