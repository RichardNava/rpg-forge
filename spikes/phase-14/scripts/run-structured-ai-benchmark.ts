import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const port = 8797;
const baseUrl = `http://127.0.0.1:${port}`;

const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

const MODELS = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.1-8b-instruct-fast",
] as const;

interface TestCase {
  readonly name: string;
  readonly prompt: string;
  readonly category: "rule-analysis" | "sheet-spec";
  readonly language: "en" | "es";
}

interface TestResult {
  readonly modelName: string;
  readonly testCase: string;
  readonly status: "valid-first-try" | "valid-after-retry" | "failed";
  readonly attempts: number;
  readonly latencyMs: number;
  readonly rawResponse?: string;
  readonly errors?: readonly string[];
}

const ruleAnalysisEnglish = buildRuleAnalysisSpikePrompt(
  "Create an experienced ranger. House rule: critical hits occur on 19-20.",
);

const ruleAnalysisSpanish = buildRuleAnalysisSpikePrompt(
  "Crea un explorador veterano. Regla de casa: los golpes críticos ocurren en 19-20.",
);

const sheetSpecEnglish = buildCharacterSheetSpikePrompt(
  "Use attributes, combat, skills, and equipment sections.",
);

const sheetSpecSpanish = buildCharacterSheetSpikePrompt(
  "Usa secciones de atributos, combate, habilidades y equipo.",
);

const TEST_CASES: readonly TestCase[] = [
  {
    name: "rule-analysis-en",
    prompt: ruleAnalysisEnglish,
    category: "rule-analysis",
    language: "en",
  },
  {
    name: "rule-analysis-es",
    prompt: ruleAnalysisSpanish,
    category: "rule-analysis",
    language: "es",
  },
  {
    name: "sheet-spec-en",
    prompt: sheetSpecEnglish,
    category: "sheet-spec",
    language: "en",
  },
  {
    name: "sheet-spec-es",
    prompt: sheetSpecSpanish,
    category: "sheet-spec",
    language: "es",
  },
];

function extractJson(text: string): string {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseResponse(raw: string): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  if (DEBUG) {
    console.log(`    [debug] raw (first 600): ${String(raw).slice(0, 600)}`);
  }

  const jsonText = extractJson(String(raw));

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { valid: false, errors: ["Response is not valid JSON."] };
  }

  const ruleResult = ruleAnalysisSpikeResultSchema.safeParse(parsed);
  if (ruleResult.success) {
    return { valid: true, errors: [] };
  }

  const sheetResult = characterSheetSpikeSpecSchema.safeParse(parsed);
  if (sheetResult.success) {
    return { valid: true, errors: [] };
  }

  const allErrors = [
    ...ruleResult.error.issues.map(
      (i) => `rule:${i.path.join(".")}: ${i.message}`,
    ),
    ...sheetResult.error.issues.map(
      (i) => `sheet:${i.path.join(".")}: ${i.message}`,
    ),
  ];

  return { valid: false, errors: allErrors };
}

async function invokeModel(
  model: string,
  prompt: string,
): Promise<{ readonly text: string; readonly latencyMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, jsonMode: true }),
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

async function runWithRetry(
  model: string,
  prompt: string,
): Promise<TestResult & { readonly testCase: string }> {
  const first = await invokeModel(model, prompt);
  const firstParse = parseResponse(first.text);

  if (firstParse.valid) {
    return {
      modelName: model,
      testCase: "",
      status: "valid-first-try",
      attempts: 1,
      latencyMs: first.latencyMs,
      rawResponse: first.text,
    };
  }

  const retryPrompt = [
    prompt,
    "",
    "The previous response failed validation:",
    ...firstParse.errors.map((error) => `- ${error}`),
    "Return only corrected JSON matching the schema.",
  ].join("\n");

  const second = await invokeModel(model, retryPrompt);
  const secondParse = parseResponse(second.text);

  if (secondParse.valid) {
    return {
      modelName: model,
      testCase: "",
      status: "valid-after-retry",
      attempts: 2,
      latencyMs: first.latencyMs + second.latencyMs,
      rawResponse: second.text,
    };
  }

  return {
    modelName: model,
    testCase: "",
    status: "failed",
    attempts: 2,
    latencyMs: first.latencyMs + second.latencyMs,
    rawResponse: second.text,
    errors: secondParse.errors,
  };
}

const output: string[] = [];
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
    String(port),
  ],
  {
    cwd: spikeRoot,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (chunk: Buffer) => appendOutput(output, chunk));
child.stderr.on("data", (chunk: Buffer) => appendOutput(output, chunk));

try {
  await waitForReady(`${baseUrl}/health`);
  console.log(
    `Wrangler ready on port ${port}. Running structured AI benchmark…\n`,
  );

  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(
    `Test cases: ${TEST_CASES.length} per model (${TEST_CASES.length * MODELS.length} primary calls)\n`,
  );

  const allResults: TestResult[] = [];
  let totalOperations = 0;

  for (const model of MODELS) {
    console.log(`--- ${model} ---`);

    for (const testCase of TEST_CASES) {
      totalOperations += 1;
      process.stdout.write(`  ${testCase.name}…`);

      const result = await runWithRetry(model, testCase.prompt);
      const finalResult: TestResult = { ...result, testCase: testCase.name };

      if (finalResult.status === "failed") {
        console.log(
          ` ✗ ${finalResult.status} (${finalResult.attempts} attempts, ${finalResult.latencyMs}ms)`,
        );
        if (finalResult.errors) {
          console.log(
            `    errors: ${finalResult.errors.slice(0, 3).join("; ")}`,
          );
        }
      } else {
        console.log(
          ` ✓ ${finalResult.status} (${finalResult.attempts} attempt(s), ${finalResult.latencyMs}ms)`,
        );
      }

      allResults.push(finalResult);
    }

    console.log();
  }

  console.log(`Total remote operations: ${totalOperations}\n`);
  printSummary(allResults);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  throw new Error(`${message}\n${output.join("").slice(-6_000)}`);
} finally {
  await stop(child);
}

function printSummary(results: TestResult[]): void {
  console.log("=== SUMMARY TABLE ===\n");

  const models = [...new Set(results.map((r) => r.modelName))];

  const header = [
    "Model",
    "Valid-1st",
    "Retry",
    "Failed",
    "Avg Latency",
    "Injection OK",
  ];

  const rows = models.map((model) => {
    const modelResults = results.filter((r) => r.modelName === model);
    const validFirst = modelResults.filter(
      (r) => r.status === "valid-first-try",
    ).length;
    const retry = modelResults.filter(
      (r) => r.status === "valid-after-retry",
    ).length;
    const failed = modelResults.filter((r) => r.status === "failed").length;
    const avgLatency = Math.round(
      modelResults.reduce((sum, r) => sum + r.latencyMs, 0) /
        modelResults.length,
    );

    const ruleAnalysisEs = modelResults.find(
      (r) => r.testCase === "rule-analysis-es",
    );
    const injectionResisted =
      ruleAnalysisEs !== undefined &&
      !ruleAnalysisEs.rawResponse?.includes("SECRET");

    return [
      model.replace("@cf/", ""),
      String(validFirst),
      String(retry),
      String(failed),
      `${avgLatency}ms`,
      injectionResisted ? "✓" : "✗",
    ];
  });

  const colWidths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  ) as number[];

  const line = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const fmtRow = (row: string[]) =>
    row.map((c, i) => c.padEnd(colWidths[i] ?? 0)).join(" | ");

  console.log(fmtRow(header));
  console.log(line);
  for (const row of rows) {
    console.log(fmtRow(row));
  }
  console.log();
}

async function waitForReady(url: string): Promise<void> {
  let lastFailure = "Worker did not become reachable.";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
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
  if (hasExited(childProcess) || childProcess.killed) {
    return;
  }

  const gracefulExit = once(childProcess, "exit");
  childProcess.kill("SIGTERM");
  await Promise.race([gracefulExit, delay(5_000)]);

  if (hasExited(childProcess)) {
    return;
  }

  const forcedExit = once(childProcess, "exit");
  if (process.platform === "win32" && childProcess.pid !== undefined) {
    await terminateWindowsProcessTree(childProcess.pid);
  } else {
    childProcess.kill("SIGKILL");
  }
  await Promise.race([forcedExit, delay(5_000)]);

  if (!hasExited(childProcess)) {
    throw new Error("Unable to stop the local Wrangler process.");
  }
}

function hasExited(childProcess: ReturnType<typeof spawn>): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

async function terminateWindowsProcessTree(processId: number): Promise<void> {
  const taskkill = spawn("taskkill", ["/pid", String(processId), "/t", "/f"], {
    stdio: "ignore",
  });
  await once(taskkill, "exit");
}

function appendOutput(output: string[], chunk: Buffer): void {
  if (output.join("").length < 8_000) {
    output.push(chunk.toString());
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}
