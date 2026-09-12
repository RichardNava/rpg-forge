import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FAILURE_CLASS_LABELS } from "../extraction-validation/classify.js";
import {
  EXTRACTION_VALIDATION_FIXTURES,
  type ExtractionValidationFixture,
} from "../extraction-validation/fixtures.js";
import { runExtractionFixture } from "../extraction-validation/harness.js";
import { CRITICAL_FIXTURE_IDS } from "../extraction-validation/matrix.js";
import {
  RemoteInstructionExtractionPort,
  RecordingInstructionExtractionPort,
} from "../extraction-validation/remote-port.js";
import {
  evaluateExtractionFixture,
  type ExtractionCallRecord,
  type ExtractionRunResult,
  type FixtureEvaluation,
} from "../extraction-validation/scoring.js";

const EXPERIMENT_MODELS = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
] as const;

type ExperimentModel = (typeof EXPERIMENT_MODELS)[number];

interface CompletedExperiment {
  readonly model: ExperimentModel;
  readonly fixtureId: string;
  readonly run: ExtractionRunResult;
  readonly evaluation: FixtureEvaluation;
}

interface ModelStats {
  readonly model: ExperimentModel;
  readonly criticalPasses: number;
  readonly firstAttemptPasses: number;
  readonly replayCount: number;
  readonly replayRecoveries: number;
  readonly schemaFailures: number;
  readonly jsonFailures: number;
  readonly providerErrors: number;
  readonly semanticFailures: number;
  readonly totalCalls: number;
  readonly totalLatencyMs: number;
  readonly meanLatencyMs: number;
  readonly medianLatencyMs: number;
  readonly maxLatencyMs: number;
  readonly meanFirstAttemptLatencyMs: number;
  readonly usageExposed: boolean;
  readonly totalOutputTokens: number;
  readonly totalInputTokens: number;
  readonly qualification: ModelQualification;
  readonly passedFixtureIds: readonly string[];
}

type ModelQualification =
  "QUALIFIED" | "MATERIAL BUT INCOMPLETE" | "FAILS EXTRACTION CONTRACT";

type ComparisonClassification = "A" | "B" | "C" | "D" | "E" | "F" | "BLOCKED";

const CLOSING_PHRASES: Record<ComparisonClassification, string> = {
  A: "PHASE 14.5 2C2C COMPLETE — BOTH MODELS QUALIFY",
  B: "PHASE 14.5 2C2C COMPLETE — GPT-OSS QUALIFIES",
  C: "PHASE 14.5 2C2C COMPLETE — LLAMA QUALIFIES",
  D: "PHASE 14.5 2C2C COMPLETE — NEITHER QUALIFIES, MATERIAL DIFFERENCE",
  E: "PHASE 14.5 2C2C COMPLETE — MODEL SEARCH STOPPED FOR PHASE 14.5",
  F: "PHASE 14.5 2C2C BLOCKED — INCOMPLETE REMOTE MATRIX",
  BLOCKED: "PHASE 14.5 2C2C BLOCKED — INCOMPLETE REMOTE MATRIX",
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(spikeRoot, "..", "..");
const resultsRoot = resolve(repoRoot, "tmp", "phase-14.5-2c2c-dual-model");
const wranglerBin = resolve(
  spikeRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const SPIKED_FILES = [
  "spikes/phase-14/scripts/run-dual-model-extraction-validation.ts",
  "spikes/phase-14/package.json",
];

class BlockedRunError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function isProviderBlock(
  calls: readonly ExtractionCallRecord[],
  model: string,
): string | null {
  const BLOCK_PATTERN =
    /quota|rate.?limit|\b403\b|\b429\b|\b503\b|10000|too many|insufficient allocation|overload/i;
  for (const call of calls) {
    if (call.error === null) {
      continue;
    }
    const probe = `${call.error.name} ${call.error.message} ${model}`;
    if (BLOCK_PATTERN.test(probe)) {
      return probe;
    }
  }
  return null;
}

function readPortArg(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? argv[index + 1] : undefined;
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 8798;
}

function hasValidateOnlyFlag(argv: readonly string[]): boolean {
  return argv.includes("--validate-only");
}

function resolveCriticalFixtures(): readonly ExtractionValidationFixture[] {
  const byId = new Map(
    EXTRACTION_VALIDATION_FIXTURES.map((fixture) => [fixture.id, fixture]),
  );
  const fixtures = CRITICAL_FIXTURE_IDS.map((id) => byId.get(id));
  const resolved = fixtures.filter(
    (fixture): fixture is ExtractionValidationFixture =>
      fixture !== undefined && fixture.critical,
  );
  if (resolved.length !== CRITICAL_FIXTURE_IDS.length) {
    throw new Error(
      `Critical fixture resolution failed: expected ${CRITICAL_FIXTURE_IDS.join(
        ", ",
      )}.`,
    );
  }
  return resolved;
}

function describeMatrix(): string {
  const lines: string[] = [];
  lines.push("Resolved dual-model experiment matrix (critical fixtures only):");
  lines.push(`  model A: ${EXPERIMENT_MODELS[0]}`);
  lines.push(`  model B: ${EXPERIMENT_MODELS[1]}`);
  lines.push(`  fixtures: ${CRITICAL_FIXTURE_IDS.join(" ")} (all critical)`);
  lines.push(
    `  experiments: ${EXPERIMENT_MODELS.length} models x ${CRITICAL_FIXTURE_IDS.length} fixtures = ${EXPERIMENT_MODELS.length * CRITICAL_FIXTURE_IDS.length}`,
  );
  lines.push(
    "  provider-call budget per model+fixture: first attempt + one correction replay (max 2).",
  );
  lines.push(
    `  maximum theoretical remote calls: ${EXPERIMENT_MODELS.length * CRITICAL_FIXTURE_IDS.length * 2}`,
  );
  return lines.join("\n");
}

function sign(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1).replace(/[^a-z0-9.-]/gi, "-");
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateModelStats(
  model: ExperimentModel,
  experiments: readonly CompletedExperiment[],
): ModelStats {
  const evaluations = experiments
    .filter((experiment) => experiment.model === model)
    .map((experiment) => experiment.evaluation);

  const passed = evaluations.filter((evaluation) => evaluation.passed);
  const passedIds = passed.map((evaluation) => evaluation.fixtureId);
  const firstAttemptPassed = passed.filter(
    (evaluation) => !evaluation.checks.replayUsed,
  ).length;
  const replayCount = evaluations.filter(
    (evaluation) => evaluation.checks.replayUsed,
  ).length;
  const replayRecoveries = evaluations.filter(
    (evaluation) => evaluation.checks.recoveredOnReplay,
  ).length;
  const schemaFailures = evaluations.filter((evaluation) =>
    evaluation.attempts.some((attempt) => attempt === "schema_fail"),
  ).length;
  const jsonFailures = evaluations.filter((evaluation) =>
    evaluation.attempts.some((attempt) => attempt === "json_fail"),
  ).length;
  const providerErrors = evaluations.filter((evaluation) =>
    evaluation.attempts.some((attempt) => attempt === "provider_error"),
  ).length;
  const semanticFailures = evaluations.filter(
    (evaluation) => !evaluation.passed && evaluation.classification === "D",
  ).length;

  const totalCalls = evaluations.reduce(
    (sum, evaluation) => sum + evaluation.calls.length,
    0,
  );
  const totalLatencyMs = evaluations.reduce(
    (sum, evaluation) => sum + evaluation.totalElapsedMs,
    0,
  );
  const fixtureLatencies = evaluations.map(
    (evaluation) => evaluation.totalElapsedMs,
  );
  const firstAttemptLatencies = evaluations.map(
    (evaluation) => evaluation.calls[0]?.elapsedMs ?? 0,
  );

  const allCalls = evaluations.flatMap((evaluation) => evaluation.calls);
  const usageExposed = allCalls.some((call) => call.usage !== null);
  let totalOutputTokens = 0;
  let totalInputTokens = 0;
  if (usageExposed) {
    for (const call of allCalls) {
      const usage = asUsageRecord(call.usage);
      if (usage === null) {
        continue;
      }
      totalOutputTokens += numberOrZero(usage.output_tokens);
      totalInputTokens += numberOrZero(usage.input_tokens);
    }
  }

  const qualification = (() => {
    if (passedIds.length === CRITICAL_FIXTURE_IDS.length) {
      return "QUALIFIED" as const;
    }
    if (passedIds.length >= 5) {
      return "MATERIAL BUT INCOMPLETE" as const;
    }
    return "FAILS EXTRACTION CONTRACT" as const;
  })();

  return {
    model,
    criticalPasses: passed.length,
    firstAttemptPasses: firstAttemptPassed,
    replayCount,
    replayRecoveries,
    schemaFailures,
    jsonFailures,
    providerErrors,
    semanticFailures,
    totalCalls,
    totalLatencyMs,
    meanLatencyMs: mean(fixtureLatencies),
    medianLatencyMs: median(fixtureLatencies),
    maxLatencyMs: Math.max(0, ...fixtureLatencies),
    meanFirstAttemptLatencyMs: mean(firstAttemptLatencies),
    usageExposed,
    totalOutputTokens,
    totalInputTokens,
    qualification,
    passedFixtureIds: passedIds,
  };
}

function asUsageRecord(usage: unknown): Record<string, unknown> | null {
  if (typeof usage !== "object" || usage === null) {
    return null;
  }
  return usage as Record<string, unknown>;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function classifyComparison(
  gpt: ModelStats,
  llama: ModelStats,
  blocked: boolean,
): ComparisonClassification {
  if (blocked) {
    return "BLOCKED";
  }
  const gptQualified = gpt.qualification === "QUALIFIED";
  const llamaQualified = llama.qualification === "QUALIFIED";
  const gptMaterial = gpt.qualification === "MATERIAL BUT INCOMPLETE";
  const llamaMaterial = llama.qualification === "MATERIAL BUT INCOMPLETE";
  if (gptQualified && llamaQualified) {
    return "A";
  }
  if (gptQualified) {
    return "B";
  }
  if (llamaQualified) {
    return "C";
  }
  if (gptMaterial || llamaMaterial) {
    return "D";
  }
  return "E";
}

function renderComparisonReport(input: {
  readonly command: string;
  readonly order: readonly {
    readonly model: ExperimentModel;
    readonly fixtureId: string;
  }[];
  readonly experiments: readonly CompletedExperiment[];
  readonly gpt: ModelStats;
  readonly llama: ModelStats;
  readonly comparison: ComparisonClassification;
  readonly blockedMessage: string | null;
}): string {
  const lines: string[] = [];
  lines.push("# 2C2C — Dual-model critical-fixture extraction validation");
  lines.push("");
  lines.push(`Command: \`${input.command}\``);
  lines.push("");
  lines.push("## Matrix");
  lines.push("");
  lines.push(`Models: ${EXPERIMENT_MODELS.join(" ; ")}`);
  lines.push(`Critical fixtures: ${CRITICAL_FIXTURE_IDS.join(", ")}`);
  lines.push("");
  lines.push("## Execution order (interleaved by fixture, GPT-OSS then Llama)");
  lines.push("");
  lines.push(
    input.order
      .map((entry) => `- ${entry.fixtureId}: ${entry.model}`)
      .join("\n"),
  );
  lines.push("");
  lines.push("## Per-fixture results");
  lines.push("");
  lines.push(
    "| Fixture | Model | Calls | Replay | Outcome | Class | Final ops | Notes |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const fixtureId of CRITICAL_FIXTURE_IDS) {
    for (const model of EXPERIMENT_MODELS) {
      const experiment = input.experiments.find(
        (candidate) =>
          candidate.model === model && candidate.fixtureId === fixtureId,
      );
      if (experiment === undefined) {
        continue;
      }
      const evaluation = experiment.evaluation;
      const replay = evaluation.checks.replayUsed ? "yes" : "no";
      const outcome = evaluation.outcomeKind;
      const classLabel = evaluation.classification;
      const finalOps =
        evaluation.finalSignatures.length === 0
          ? "(none)"
          : JSON.stringify(evaluation.finalSignatures);
      const notes =
        evaluation.notes.length === 0 ? "-" : evaluation.notes.join("; ");
      lines.push(
        `| ${fixtureId} | ${model} | ${evaluation.calls.length} | ${replay} | ${outcome} | ${classLabel} | ${finalOps} | ${notes} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Performance comparison");
  lines.push("");
  lines.push("| Metric | GPT-OSS 120B | Llama 3.3 70B |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| Critical passes / 7 | ${input.gpt.criticalPasses} | ${input.llama.criticalPasses} |`,
  );
  lines.push(
    `| First-attempt passes / 7 | ${input.gpt.firstAttemptPasses} | ${input.llama.firstAttemptPasses} |`,
  );
  lines.push(
    `| Replays | ${input.gpt.replayCount} | ${input.llama.replayCount} |`,
  );
  lines.push(
    `| Replay recoveries | ${input.gpt.replayRecoveries} | ${input.llama.replayRecoveries} |`,
  );
  lines.push(
    `| Schema failures | ${input.gpt.schemaFailures} | ${input.llama.schemaFailures} |`,
  );
  lines.push(
    `| JSON parse failures | ${input.gpt.jsonFailures} | ${input.llama.jsonFailures} |`,
  );
  lines.push(
    `| Provider/transport errors | ${input.gpt.providerErrors} | ${input.llama.providerErrors} |`,
  );
  lines.push(
    `| Semantic failures | ${input.gpt.semanticFailures} | ${input.llama.semanticFailures} |`,
  );
  lines.push(
    `| Total calls | ${input.gpt.totalCalls} | ${input.llama.totalCalls} |`,
  );
  lines.push(
    `| Total latency (ms) | ${input.gpt.totalLatencyMs.toFixed(2)} | ${input.llama.totalLatencyMs.toFixed(2)} |`,
  );
  lines.push(
    `| Mean fixture latency (ms) | ${input.gpt.meanLatencyMs.toFixed(2)} | ${input.llama.meanLatencyMs.toFixed(2)} |`,
  );
  lines.push(
    `| Median fixture latency (ms) | ${input.gpt.medianLatencyMs.toFixed(2)} | ${input.llama.medianLatencyMs.toFixed(2)} |`,
  );
  lines.push(
    `| Max fixture latency (ms) | ${input.gpt.maxLatencyMs.toFixed(2)} | ${input.llama.maxLatencyMs.toFixed(2)} |`,
  );
  lines.push(
    `| Mean first-attempt latency (ms) | ${input.gpt.meanFirstAttemptLatencyMs.toFixed(2)} | ${input.llama.meanFirstAttemptLatencyMs.toFixed(2)} |`,
  );
  const tokens = (stats: ModelStats): string =>
    stats.usageExposed
      ? `in=${stats.totalInputTokens} out=${stats.totalOutputTokens}`
      : "N/A (provider did not expose usage)";
  lines.push(`| Token usage | ${tokens(input.gpt)} | ${tokens(input.llama)} |`);
  lines.push("");
  lines.push(
    "p95 fixture latency: not meaningful with 7 samples per model; max shown above for reference.",
  );
  lines.push("");
  lines.push(`## Model classifications`);
  lines.push("");
  lines.push(
    `GPT-OSS 120B: **${input.gpt.qualification}** (${input.gpt.criticalPasses}/7 critical)`,
  );
  lines.push(
    `Llama 3.3 70B: **${input.llama.qualification}** (${input.llama.criticalPasses}/7 critical)`,
  );
  lines.push("");
  lines.push(`## Historical Scout reference (2C2B, untouched artifacts)`);
  lines.push("");
  lines.push(
    `Scout: 2/13 overall, 0/7 critical. Included for context only; not part of this matrix.`,
  );
  lines.push("");
  lines.push(`## Comparison classification`);
  lines.push("");
  if (input.blockedMessage !== null) {
    lines.push(`Blocked: ${input.blockedMessage}`);
    lines.push("");
  }
  lines.push(CLOSING_PHRASES[input.comparison]);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const port = readPortArg(process.argv);
  const validateOnly = hasValidateOnlyFlag(process.argv);

  const sheetGenerationModel = process.env.SHEET_GENERATION_MODEL ?? null;
  if (sheetGenerationModel !== null) {
    throw new Error(
      `Refusing to run 2C2C with SHEET_GENERATION_MODEL set to "${sheetGenerationModel}". The knob must remain unset.`,
    );
  }

  const fixtures = resolveCriticalFixtures();
  console.log(describeMatrix());
  if (validateOnly) {
    console.log(
      `\nVALIDATION-ONLY: matrix valid (${EXPERIMENT_MODELS.length} models x ${fixtures.length} critical fixtures). No remote inference will run.`,
    );
    return;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(resultsRoot, runId);

  const order: {
    readonly model: ExperimentModel;
    readonly fixtureId: string;
  }[] = [];
  const experiments: CompletedExperiment[] = [];
  const output: string[] = [];

  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--config",
      "extraction-validation/wrangler.jsonc",
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

  let blocked = false;

  try {
    await mkdir(outDir, { recursive: true });
    await waitForReady(`${baseUrl}/health`);
    console.log(
      `\n2C2C dual-model extraction validation ready on port ${port}. Results: ${outDir}\n`,
    );

    for (const fixture of fixtures) {
      for (const model of EXPERIMENT_MODELS) {
        process.stdout.write(`${fixture.id} ${model}…`);
        order.push({ model, fixtureId: fixture.id });
        const remote = new RemoteInstructionExtractionPort(baseUrl, model);
        const recording = new RecordingInstructionExtractionPort(remote);
        const run = await runExtractionFixture({ fixture, port: recording });
        const evaluation = evaluateExtractionFixture(fixture, run);
        experiments.push({ model, fixtureId: fixture.id, run, evaluation });

        const block = isProviderBlock(run.calls, model);
        if (block !== null) {
          throw new BlockedRunError(
            `Workers AI provider/quota block detected on ${fixture.id} (${model}): ${block}`,
          );
        }

        await writeFile(
          join(outDir, `${sign(model)}-${fixture.id}.json`),
          `${JSON.stringify({ model, fixtureId: fixture.id, result: run, evaluation }, null, 2)}\n`,
        );

        const replay = evaluation.checks.replayUsed ? " (replay)" : "";
        console.log(
          ` ${evaluation.passed ? "PASS" : "FAIL"}${replay} class=${evaluation.classification} calls=${evaluation.calls.length} total=${evaluation.totalElapsedMs}ms`,
        );
        for (const note of evaluation.notes) {
          console.log(`    - ${note}`);
        }
      }
    }

    const gpt = evaluateModelStats(EXPERIMENT_MODELS[0], experiments);
    const llama = evaluateModelStats(EXPERIMENT_MODELS[1], experiments);
    const comparison = classifyComparison(gpt, llama, blocked);
    const command =
      "pnpm --filter @rpg-forge/phase-14-spikes benchmark:dual-model-extraction-validation";
    const gitStatusShort = readGitStatusShort();

    await writeFile(
      join(outDir, "summary.json"),
      `${JSON.stringify(
        {
          runId,
          comparison,
          models: [gpt, llama],
          experiments: experiments.map((experiment) => ({
            model: experiment.model,
            fixtureId: experiment.fixtureId,
            passed: experiment.evaluation.passed,
            classification: experiment.evaluation.classification,
            outcomeKind: experiment.evaluation.outcomeKind,
            checks: experiment.evaluation.checks,
          })),
          gitStatusShort,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(outDir, "summary.md"),
      renderComparisonReport({
        command,
        order,
        experiments,
        gpt,
        llama,
        comparison,
        blockedMessage: null,
      }),
      "utf8",
    );

    printTable(experiments);
    console.log(`\nFull results: ${outDir}`);
    console.log(
      `GPT-OSS 120B: ${gpt.qualification} (${gpt.criticalPasses}/7 critical; passes: ${gpt.passedFixtureIds.join(", ") || "(none)"})`,
    );
    console.log(
      `Llama 3.3 70B: ${llama.qualification} (${llama.criticalPasses}/7 critical; passes: ${llama.passedFixtureIds.join(", ") || "(none)"})`,
    );
    console.log(CLOSING_PHRASES[comparison]);
  } catch (error) {
    if (error instanceof BlockedRunError) {
      blocked = true;
      if (experiments.length > 0) {
        const partialGpt = evaluateModelStats(
          EXPERIMENT_MODELS[0],
          experiments,
        );
        const partialLlama = evaluateModelStats(
          EXPERIMENT_MODELS[1],
          experiments,
        );
        try {
          await writeFile(
            join(outDir, "summary.partial.md"),
            renderComparisonReport({
              command:
                "pnpm --filter @rpg-forge/phase-14-spikes benchmark:dual-model-extraction-validation (blocked)",
              order,
              experiments,
              gpt: partialGpt,
              llama: partialLlama,
              comparison: "BLOCKED",
              blockedMessage: error.message,
            }),
            "utf8",
          );
        } catch {
          // partial artifact write failure does not mask the block
        }
        console.log(
          `\n${error.message}\nCompleted ${experiments.length}/${EXPERIMENT_MODELS.length * CRITICAL_FIXTURE_IDS.length} model/fixture pairs.`,
        );
      } else {
        console.log(`\n${error.message}\nNo model/fixture pair completed.`);
      }
      console.log(CLOSING_PHRASES.BLOCKED);
      console.error("Result: " + CLOSING_PHRASES.BLOCKED);
      process.exitCode = 1;
      return;
    }
    const wrapped = error instanceof Error ? error.message : "Unknown failure.";
    throw new Error(`${wrapped}\n${output.join("").slice(-6_000)}`);
  } finally {
    await stop(child);
  }
}

function printTable(experiments: readonly CompletedExperiment[]): void {
  console.log("\n=== 2C2C EXTRACTION VALIDATION TABLE ===\n");
  const header = [
    "Fixture",
    "Model",
    "Calls",
    "Replay",
    "Outcome",
    "Class",
    "Result",
  ];
  const rows = experiments.map((experiment) => [
    experiment.fixtureId,
    sign(experiment.model),
    String(experiment.evaluation.calls.length),
    experiment.evaluation.checks.replayUsed ? "yes" : "no",
    experiment.evaluation.outcomeKind,
    String(experiment.evaluation.classification),
    experiment.evaluation.passed ? "ok" : "FAIL",
  ]);
  const colWidths = header.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => (row[index] ?? "").length)),
  ) as number[];
  const line = colWidths.map((width) => "-".repeat(width)).join(" | ");
  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(colWidths[index] ?? 0)).join(" | ");
  console.log(formatRow(header));
  console.log(line);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log();
}

function readGitStatusShort(): string {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const stdout = result.stdout?.trim() ?? "";
  return stdout.length === 0 ? "(no changes)" : stdout;
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

const entryPath = process.argv[1];
const isEntryPoint =
  entryPath !== undefined &&
  fileURLToPath(import.meta.url) === resolve(entryPath);

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
