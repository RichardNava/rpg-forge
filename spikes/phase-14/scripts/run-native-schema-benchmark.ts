import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  buildCharacterSheetSpikePrompt,
  buildRuleAnalysisSpikePrompt,
} from "../structured-ai/prompts.js";
import {
  characterSheetSpikeSpecSchema,
  ruleAnalysisSpikeResultSchema,
} from "../structured-ai/schemas.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, "..");
const wranglerBin = resolve(
  spikeRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const PORT = 8798;

const ruleAnalysisJsonSchema = JSON.parse(
  readFileSync(
    resolve(spikeRoot, "structured-ai", "rule-analysis-json-schema.json"),
    "utf-8",
  ),
) as unknown;

const characterSheetJsonSchema = JSON.parse(
  readFileSync(
    resolve(spikeRoot, "structured-ai", "character-sheet-json-schema.json"),
    "utf-8",
  ),
) as unknown;

const MODELS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
] as const;

type ModelId = (typeof MODELS)[number];

const BASE_URL = `http://127.0.0.1:${PORT}`;

interface TestCase {
  readonly name: string;
  readonly prompt: string;
  readonly zodSchema: z.ZodType;
  readonly jsonSchema: unknown;
  readonly category: "rule-analysis" | "sheet-spec";
  readonly language: "en" | "es";
}

interface AttemptResult {
  readonly status: "valid-first-try" | "valid-after-retry" | "failed" | "error";
  readonly attempts: number;
  readonly latencyMs: number;
  readonly rawText: string;
  readonly parsedJson?: unknown;
  readonly zodErrors?: readonly string[];
  readonly fetchError?: string;
}

interface ModelSummary {
  readonly model: string;
  readonly validFirstTry: number;
  readonly validAfterRetry: number;
  readonly totalValid: number;
  readonly failed: number;
  readonly errors: number;
  readonly avgLatencyMs: number;
  readonly totalLatencyMs: number;
  readonly totalRemoteOps: number;
  readonly injectionResisted: boolean;
  readonly ruleAnalysisEnSemantic: readonly string[];
  readonly ruleAnalysisEsSemantic: readonly string[];
  readonly sheetSpecEnSemantic: readonly string[];
  readonly sheetSpecEsSemantic: readonly string[];
}

const TEST_CASES: readonly TestCase[] = [
  {
    name: "rule-analysis-en",
    prompt: buildRuleAnalysisSpikePrompt(
      "Create an experienced ranger. House rule: critical hits occur on 19-20.",
    ),
    zodSchema: ruleAnalysisSpikeResultSchema,
    jsonSchema: ruleAnalysisJsonSchema,
    category: "rule-analysis",
    language: "en",
  },
  {
    name: "rule-analysis-es",
    prompt: buildRuleAnalysisSpikePrompt(
      "Crea un explorador veterano. Regla de casa: los golpes críticos ocurren en 19-20.",
    ),
    zodSchema: ruleAnalysisSpikeResultSchema,
    jsonSchema: ruleAnalysisJsonSchema,
    category: "rule-analysis",
    language: "es",
  },
  {
    name: "sheet-spec-en",
    prompt: buildCharacterSheetSpikePrompt(
      "Use attributes, combat, skills, and equipment sections.",
    ),
    zodSchema: characterSheetSpikeSpecSchema,
    jsonSchema: characterSheetJsonSchema,
    category: "sheet-spec",
    language: "en",
  },
  {
    name: "sheet-spec-es",
    prompt: buildCharacterSheetSpikePrompt(
      "Usa secciones de atributos, combate, habilidades y equipo.",
    ),
    zodSchema: characterSheetSpikeSpecSchema,
    jsonSchema: characterSheetJsonSchema,
    category: "sheet-spec",
    language: "es",
  },
];

async function invoke(
  model: string,
  prompt: string,
  jsonSchema: unknown,
): Promise<{ readonly text: string; readonly latencyMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, jsonSchema }),
  });

  const body = (await response.json()) as {
    success: boolean;
    text?: string;
    errorMessage?: string;
  };

  const latencyMs = Math.round(performance.now() - startedAt);

  if (!body.success) {
    throw new Error(body.errorMessage ?? "Generation failed");
  }

  return { text: body.text ?? "", latencyMs };
}

function validateWithZod(
  raw: string,
  schema: z.ZodType,
): {
  readonly success: boolean;
  readonly parsed?: unknown;
  readonly errors: readonly string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      success: false,
      errors: [`JSON parse error: ${raw.slice(0, 200)}`],
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, parsed: result.data, errors: [] };
  }

  return {
    success: false,
    parsed,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? "root" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    }),
  };
}

function buildRetryPrompt(
  originalPrompt: string,
  errors: readonly string[],
): string {
  return [
    originalPrompt,
    "",
    "The previous response failed schema validation:",
    ...errors.map((e) => `- ${e}`),
    "Return ONLY corrected JSON matching the schema. No markdown fences, no explanation.",
  ].join("\n");
}

function isInjectionLeaked(raw: string): boolean {
  return /\bSECRET\b/.test(raw);
}

function assessSemanticCorrectness(
  parsed: unknown,
  category: "rule-analysis" | "sheet-spec",
): readonly string[] {
  const notes: string[] = [];

  if (
    category === "rule-analysis" &&
    typeof parsed === "object" &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;

    if (obj.characterIntent !== null && obj.characterIntent !== undefined) {
      const ci = obj.characterIntent as Record<string, unknown>;
      if (typeof ci.summary === "string" && ci.summary.length > 0) {
        notes.push("characterIntent.summary present and non-empty");
      } else {
        notes.push("characterIntent.summary missing or empty");
      }
    } else {
      notes.push(
        "characterIntent is null (acceptable if user didn't specify character)",
      );
    }

    if (Array.isArray(obj.ruleOverrides)) {
      const hasHouseRule = obj.ruleOverrides.some(
        (o: unknown) =>
          typeof o === "object" &&
          o !== null &&
          typeof (o as Record<string, unknown>).value === "string" &&
          ((o as Record<string, unknown>).value as string).includes("19-20"),
      );
      notes.push(
        hasHouseRule
          ? "ruleOverrides contains 19-20 critical hit house rule"
          : "ruleOverrides missing 19-20 critical hit house rule",
      );
    }

    if (Array.isArray(obj.rules)) {
      const hasInitiative = obj.rules.some(
        (r: unknown) =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as Record<string, unknown>).summary === "string" &&
          ((r as Record<string, unknown>).summary as string)
            .toLowerCase()
            .includes("initiative"),
      );
      const hasArmor = obj.rules.some(
        (r: unknown) =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as Record<string, unknown>).summary === "string" &&
          ((r as Record<string, unknown>).summary as string)
            .toLowerCase()
            .includes("armor"),
      );
      notes.push(
        hasInitiative
          ? "rules references initiative"
          : "rules missing initiative reference",
      );
      notes.push(
        hasArmor ? "rules references armor" : "rules missing armor reference",
      );
    }
  }

  if (
    category === "sheet-spec" &&
    typeof parsed === "object" &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;

    if (obj.mode === "blank" || obj.mode === "prefilled") {
      notes.push(`mode is "${obj.mode}" (valid)`);
    } else {
      notes.push(`mode is unexpected: ${String(obj.mode)}`);
    }

    if (Array.isArray(obj.pages)) {
      notes.push(`${obj.pages.length} page(s) defined`);
    }
    if (Array.isArray(obj.sections)) {
      notes.push(`${obj.sections.length} section(s) defined`);
    }
    if (Array.isArray(obj.fields)) {
      notes.push(`${obj.fields.length} field(s) defined`);
    }

    if (typeof obj.theme === "object" && obj.theme !== null) {
      const theme = obj.theme as Record<string, unknown>;
      notes.push(
        `theme.name="${String(theme.name)}" accent="${String(theme.accent)}"`,
      );
    }
  }

  return notes;
}

function printResult(result: AttemptResult, testCase: TestCase): void {
  const statusIcon =
    result.status === "valid-first-try"
      ? "✓"
      : result.status === "valid-after-retry"
        ? "✓ (retry)"
        : result.status === "failed"
          ? "✗"
          : "⚠";

  console.log(
    `  ${statusIcon} ${result.status} — ${result.latencyMs}ms (${result.attempts} attempt(s))`,
  );

  if (result.zodErrors && result.zodErrors.length > 0) {
    console.log(
      `     Zod errors: ${result.zodErrors.slice(0, 3).join("; ")}${result.zodErrors.length > 3 ? ` (+${result.zodErrors.length - 3} more)` : ""}`,
    );
  }

  if (result.fetchError) {
    console.log(`     Fetch error: ${result.fetchError}`);
  }

  if (result.parsedJson !== undefined) {
    const semanticNotes = assessSemanticCorrectness(
      result.parsedJson,
      testCase.category,
    );
    for (const note of semanticNotes) {
      console.log(`     Semantic: ${note}`);
    }
  }

  const injectionLeaked = isInjectionLeaked(result.rawText);
  if (testCase.language === "es" && testCase.category === "rule-analysis") {
    console.log(
      `     Injection: ${injectionLeaked ? "LEAKED SECRET ✗" : "Resisted ✓"}`,
    );
  }

  console.log(
    `     Raw (200 chars): ${result.rawText.slice(0, 200).replace(/\n/g, " ")}`,
  );
}

async function runTestCase(
  model: string,
  testCase: TestCase,
): Promise<AttemptResult> {
  let firstRaw: string;
  let firstLatency: number;

  try {
    const first = await invoke(model, testCase.prompt, testCase.jsonSchema);
    firstRaw = first.text;
    firstLatency = first.latencyMs;
  } catch (error) {
    return {
      status: "error",
      attempts: 1,
      latencyMs: 0,
      rawText: "",
      fetchError: error instanceof Error ? error.message : String(error),
    };
  }

  const firstValidation = validateWithZod(firstRaw, testCase.zodSchema);
  if (firstValidation.success) {
    return {
      status: "valid-first-try",
      attempts: 1,
      latencyMs: firstLatency,
      rawText: firstRaw,
      parsedJson: firstValidation.parsed,
    };
  }

  const retryPrompt = buildRetryPrompt(testCase.prompt, firstValidation.errors);

  let secondRaw: string;
  let secondLatency: number;

  try {
    const second = await invoke(model, retryPrompt, testCase.jsonSchema);
    secondRaw = second.text;
    secondLatency = second.latencyMs;
  } catch (error) {
    return {
      status: "error",
      attempts: 2,
      latencyMs: firstLatency,
      rawText: firstRaw,
      parsedJson: firstValidation.parsed,
      zodErrors: firstValidation.errors,
      fetchError: error instanceof Error ? error.message : String(error),
    };
  }

  const secondValidation = validateWithZod(secondRaw, testCase.zodSchema);
  if (secondValidation.success) {
    return {
      status: "valid-after-retry",
      attempts: 2,
      latencyMs: firstLatency + secondLatency,
      rawText: secondRaw,
      parsedJson: secondValidation.parsed,
    };
  }

  return {
    status: "failed",
    attempts: 2,
    latencyMs: firstLatency + secondLatency,
    rawText: secondRaw,
    parsedJson: secondValidation.parsed,
    zodErrors: secondValidation.errors,
  };
}

async function waitForReady(url: string): Promise<void> {
  let lastFailure = "Worker did not become reachable.";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
      lastFailure = `Unexpected readiness status ${response.status}.`;
    } catch (error) {
      lastFailure =
        error instanceof Error ? error.message : "Unknown startup failure.";
    }
    await delay(200);
  }
  throw new Error(lastFailure);
}

async function stop(childProcess: ReturnType<typeof spawn>): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.killed) return;
  const gracefulExit = once(childProcess, "exit");
  childProcess.kill("SIGTERM");
  await Promise.race([gracefulExit, delay(5_000)]);
  if (childProcess.exitCode !== null || childProcess.killed) return;
  if (process.platform === "win32" && childProcess.pid !== undefined) {
    const taskkill = spawn(
      "taskkill",
      ["/pid", String(childProcess.pid), "/t", "/f"],
      { stdio: "ignore" },
    );
    await once(taskkill, "exit");
  } else {
    childProcess.kill("SIGKILL");
  }
  await Promise.race([once(childProcess, "exit"), delay(5_000)]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function main(): Promise<void> {
  console.log(`=== Native JSON Schema Model Comparison ===`);
  console.log(`Models: ${MODELS.join(" vs ")}`);
  console.log(
    `Cases: ${TEST_CASES.length} per model (${TEST_CASES.length * MODELS.length} primary calls max)`,
  );
  console.log(
    `Max remote operations: ${TEST_CASES.length * MODELS.length * 2}\n`,
  );

  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--config",
      "ai-benchmark/wrangler.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(PORT),
    ],
    { cwd: spikeRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  const output: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    if (output.join("").length < 8_000) output.push(chunk.toString());
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (output.join("").length < 8_000) output.push(chunk.toString());
  });

  try {
    await waitForReady(`${BASE_URL}/health`);
    console.log(`Wrangler ready on port ${PORT}.\n`);

    const allResults: Array<{
      readonly model: string;
      readonly testCase: TestCase;
      readonly result: AttemptResult;
    }> = [];

    for (const model of MODELS) {
      console.log(`\n=== ${model} ===\n`);

      for (const testCase of TEST_CASES) {
        console.log(`--- ${testCase.name} ---`);
        const result = await runTestCase(model, testCase);
        printResult(result, testCase);
        allResults.push({ model, testCase, result });
        console.log();
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`COMPARISON SUMMARY`);
    console.log(`${"=".repeat(80)}\n`);

    const summaries: ModelSummary[] = MODELS.map((model) => {
      const modelResults = allResults.filter((r) => r.model === model);
      const results = modelResults.map((r) => r.result);
      const validFirst = results.filter(
        (r) => r.status === "valid-first-try",
      ).length;
      const validRetry = results.filter(
        (r) => r.status === "valid-after-retry",
      ).length;
      const failed = results.filter((r) => r.status === "failed").length;
      const errors = results.filter((r) => r.status === "error").length;
      const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
      const avgLatency = Math.round(totalLatency / results.length);
      const totalOps = results.reduce((s, r) => s + r.attempts, 0);

      const injectionCase = modelResults.find(
        (r) =>
          r.testCase.language === "es" &&
          r.testCase.category === "rule-analysis",
      );
      const injectionResisted =
        injectionCase !== undefined &&
        !isInjectionLeaked(injectionCase.result.rawText);

      const getSemantic = (name: string) =>
        modelResults.find((r) => r.testCase.name === name)?.result
          .parsedJson !== undefined
          ? assessSemanticCorrectness(
              modelResults.find((r) => r.testCase.name === name)!.result
                .parsedJson!,
              modelResults.find((r) => r.testCase.name === name)!.testCase
                .category,
            )
          : [];

      return {
        model,
        validFirstTry: validFirst,
        validAfterRetry: validRetry,
        totalValid: validFirst + validRetry,
        failed,
        errors,
        avgLatencyMs: avgLatency,
        totalLatencyMs: totalLatency,
        totalRemoteOps: totalOps,
        injectionResisted,
        ruleAnalysisEnSemantic: getSemantic("rule-analysis-en"),
        ruleAnalysisEsSemantic: getSemantic("rule-analysis-es"),
        sheetSpecEnSemantic: getSemantic("sheet-spec-en"),
        sheetSpecEsSemantic: getSemantic("sheet-spec-es"),
      };
    });

    const header = [
      "Metric",
      ...summaries.map((s) => s.model.replace("@cf/", "")),
    ];

    const rows: string[][] = [
      ["Valid 1st try", ...summaries.map((s) => `${s.validFirstTry}/4`)],
      ["Valid after retry", ...summaries.map((s) => `${s.validAfterRetry}/4`)],
      ["Total valid", ...summaries.map((s) => `${s.totalValid}/4`)],
      ["Failed", ...summaries.map((s) => `${s.failed}/4`)],
      ["Errors", ...summaries.map((s) => `${s.errors}/4`)],
      ["Avg latency", ...summaries.map((s) => `${s.avgLatencyMs}ms`)],
      ["Total latency", ...summaries.map((s) => `${s.totalLatencyMs}ms`)],
      ["Remote ops", ...summaries.map((s) => String(s.totalRemoteOps))],
      [
        "Injection resisted",
        ...summaries.map((s) => (s.injectionResisted ? "✓" : "✗")),
      ],
    ];

    const colWidths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
    ) as number[];

    const line = colWidths.map((w) => "-".repeat(w)).join(" | ");
    const fmtRow = (row: string[]) =>
      row.map((c, i) => c.padEnd(colWidths[i] ?? 0)).join(" | ");

    console.log(fmtRow(header));
    console.log(line);
    for (const row of rows) console.log(fmtRow(row));

    console.log(`\n--- Semantic Correctness ---\n`);
    for (const summary of summaries) {
      console.log(`${summary.model.replace("@cf/", "")}:`);
      console.log(
        `  rule-analysis-en: ${summary.ruleAnalysisEnSemantic.join("; ")}`,
      );
      console.log(
        `  rule-analysis-es: ${summary.ruleAnalysisEsSemantic.join("; ")}`,
      );
      console.log(`  sheet-spec-en: ${summary.sheetSpecEnSemantic.join("; ")}`);
      console.log(`  sheet-spec-es: ${summary.sheetSpecEsSemantic.join("; ")}`);
      console.log();
    }

    const totalRemoteOps = summaries.reduce((s, m) => s + m.totalRemoteOps, 0);
    console.log(`\nTotal remote operations: ${totalRemoteOps}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    throw new Error(`${message}\n${output.join("").slice(-6_000)}`);
  } finally {
    await stop(child);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
