import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTHORIZED_MODEL,
  EXTRACTION_VALIDATION_NAME,
} from "../extraction-validation/config.js";
import { EXTRACTION_VALIDATION_FIXTURES } from "../extraction-validation/fixtures.js";
import { runExtractionFixture } from "../extraction-validation/harness.js";
import {
  assertAuthorizedMatrix,
  describeMatrix,
  resolveExtractionMatrix,
} from "../extraction-validation/matrix.js";
import {
  RemoteInstructionExtractionPort,
  RecordingInstructionExtractionPort,
} from "../extraction-validation/remote-port.js";
import {
  CLOSING_PHRASES,
  classifyOverall,
  computeAggregate,
  renderMarkdownReport,
} from "../extraction-validation/report.js";
import {
  evaluateExtractionFixture,
  type FixtureEvaluation,
} from "../extraction-validation/scoring.js";
import type { ExtractionCallRecord } from "../extraction-validation/scoring.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, "..");
const repoRoot = resolve(spikeRoot, "..", "..");
const resultsRoot = resolve(repoRoot, "tmp", "phase-14.5-2c2b-extraction");
const wranglerBin = resolve(
  spikeRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const FILES_CHANGED = [
  "spikes/phase-14/extraction-validation/config.ts",
  "spikes/phase-14/extraction-validation/signatures.ts",
  "spikes/phase-14/extraction-validation/fixtures.ts",
  "spikes/phase-14/extraction-validation/classify.ts",
  "spikes/phase-14/extraction-validation/scoring.ts",
  "spikes/phase-14/extraction-validation/remote-port.ts",
  "spikes/phase-14/extraction-validation/harness.ts",
  "spikes/phase-14/extraction-validation/matrix.ts",
  "spikes/phase-14/extraction-validation/report.ts",
  "spikes/phase-14/extraction-validation/wrangler.jsonc",
  "spikes/phase-14/extraction-validation/src/worker.ts",
  "spikes/phase-14/extraction-validation/src/worker.test.ts",
  "spikes/phase-14/extraction-validation/fixtures.test.ts",
  "spikes/phase-14/extraction-validation/matrix.test.ts",
  "spikes/phase-14/extraction-validation/scoring.test.ts",
  "spikes/phase-14/scripts/run-instruction-extraction-validation.ts",
  "spikes/phase-14/vitest.config.ts",
  "spikes/phase-14/package.json",
  "spikes/phase-14/sheet-benchmark/src/stage-config.ts",
];

export function readPortArg(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? argv[index + 1] : undefined;
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 8798;
}

export function hasValidateOnlyFlag(argv: readonly string[]): boolean {
  return argv.includes("--validate-only");
}

class BlockedRunError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

function isProviderBlock(
  calls: readonly ExtractionCallRecord[],
): string | null {
  const BLOCK_PATTERN =
    /quota|rate.?limit|\b403\b|\b429\b|\b503\b|10000|too many|insufficient allocation|overload/i;
  for (const call of calls) {
    if (call.error === null) {
      continue;
    }
    const probe = `${call.error.name} ${call.error.message}`;
    if (BLOCK_PATTERN.test(probe)) {
      return probe;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const port = readPortArg(process.argv);
  const validateOnly = hasValidateOnlyFlag(process.argv);

  const sheetGenerationModel = process.env.SHEET_GENERATION_MODEL ?? null;
  if (sheetGenerationModel !== null) {
    throw new Error(
      `Refusing to run 2C2B with SHEET_GENERATION_MODEL set to "${sheetGenerationModel}". The knob must remain unset.`,
    );
  }

  const matrix = resolveExtractionMatrix();
  assertAuthorizedMatrix(matrix);
  console.log(describeMatrix(matrix));
  console.log(
    `Provider-call budget per fixture: first attempt + one correction replay (max 2).`,
  );

  if (validateOnly) {
    console.log(
      `\nVALIDATION-ONLY: matrix valid (1 model x ${matrix.fixtures.length} fixtures). No remote inference will run.`,
    );
    return;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(resultsRoot, runId);

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

  try {
    await mkdir(outDir, { recursive: true });
    await waitForReady(`${baseUrl}/health`);
    console.log(
      `\n${EXTRACTION_VALIDATION_NAME} ready on port ${port}. Results: ${outDir}\n`,
    );

    const evaluations: FixtureEvaluation[] = [];

    for (const fixture of EXTRACTION_VALIDATION_FIXTURES) {
      process.stdout.write(`${fixture.id}…`);
      const remote = new RemoteInstructionExtractionPort(
        baseUrl,
        AUTHORIZED_MODEL,
      );
      const recording = new RecordingInstructionExtractionPort(remote);
      const runResult = await runExtractionFixture({
        fixture,
        port: recording,
      });
      const evaluation = evaluateExtractionFixture(fixture, runResult);
      evaluations.push(evaluation);

      const block = isProviderBlock(runResult.calls);
      if (block !== null) {
        throw new BlockedRunError(
          `Workers AI provider/quota block detected on ${fixture.id}: ${block}`,
          block,
        );
      }

      await writeFile(
        join(outDir, `${fixture.id}.json`),
        `${JSON.stringify({ fixtureId: fixture.id, result: runResult, evaluation }, null, 2)}\n`,
      );

      const replay = evaluation.checks.replayUsed ? " (replay)" : "";
      console.log(
        ` ${evaluation.passed ? "PASS" : "FAIL"}${replay} class=${evaluation.classification} calls=${evaluation.calls.length} total=${evaluation.totalElapsedMs}ms`,
      );
      for (const note of evaluation.notes) {
        console.log(`    - ${note}`);
      }
    }

    const aggregate = computeAggregate(evaluations);
    const overall = classifyOverall(evaluations, false);
    const gitStatusShort = readGitStatusShort();
    const reportInputs = {
      filesChanged: FILES_CHANGED,
      command:
        "pnpm --filter @rpg-forge/phase-14-spikes benchmark:extraction-validation",
      fixtureIdFilter: null,
      evaluations,
      aggregate,
      overall,
      blockedMessage: null,
      sheetGenerationModel,
      gitStatusShort,
      resultsDir: outDir,
      runId,
    };

    await writeFile(
      join(outDir, "summary.json"),
      `${JSON.stringify({ runId, overall, aggregate, evaluations: evaluations.map(evaluationToSummary) }, null, 2)}\n`,
    );
    await writeFile(
      join(outDir, "summary.md"),
      renderMarkdownReport(reportInputs, EXTRACTION_VALIDATION_FIXTURES),
      "utf8",
    );

    printTable(evaluations);
    console.log(`\nFull results: ${outDir}`);
    console.log(`Overall classification: ${overall}`);
    console.log(CLOSING_PHRASES[overall]);
  } catch (error) {
    const wrapped =
      error instanceof BlockedRunError
        ? `\n${error.message}\n${CLOSING_PHRASES.D}\n`
        : `${error instanceof Error ? error.message : "Unknown failure."}\n${output.join("").slice(-6_000)}`;
    throw new Error(wrapped);
  } finally {
    await stop(child);
  }
}

function evaluationToSummary(evaluation: FixtureEvaluation): object {
  return {
    fixtureId: evaluation.fixtureId,
    passed: evaluation.passed,
    critical: evaluation.critical,
    outcomeKind: evaluation.outcomeKind,
    classification: evaluation.classification,
    checks: evaluation.checks,
    attempts: evaluation.attempts,
    diagnosticCodes: evaluation.diagnosticCodes,
    gatingActed: evaluation.gatingActed,
    finalSignatures: evaluation.finalSignatures,
    notes: evaluation.notes,
  };
}

function printTable(evaluations: readonly FixtureEvaluation[]): void {
  console.log("\n=== EXTRACTION VALIDATION TABLE ===\n");
  const header = [
    "Fixture",
    "Critical",
    "Attempts",
    "Replay",
    "Outcome",
    "Class",
    "Result",
  ];
  const rows = evaluations.map((evaluation) => [
    evaluation.fixtureId,
    evaluation.critical ? "yes" : "no",
    String(evaluation.calls.length),
    evaluation.checks.replayUsed ? "yes" : "no",
    evaluation.outcomeKind,
    String(evaluation.classification),
    evaluation.passed ? "ok" : "FAIL",
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
