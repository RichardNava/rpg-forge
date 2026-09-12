import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateFixtureAcceptance,
  computeModelMetrics,
  type AcceptanceReport,
  type ModelBenchmarkMetrics,
} from "../sheet-benchmark/metrics.js";
import {
  RemoteSheetGenerationPort,
  runFixtureThroughPipeline,
  type FixtureRunResult,
} from "../sheet-benchmark/harness.js";
import {
  SHEET_BENCHMARK_FIXTURES,
  type SheetBenchmarkFixture,
} from "../sheet-benchmark/fixtures.js";
import {
  PERSONA_SLUGS,
  isValidPersonaSlug,
  type PersonaSlug,
} from "../sheet-benchmark/personas.js";

export interface ModelEntry {
  readonly id: string;
  readonly slug: string;
}

export const MODELS: readonly ModelEntry[] = [
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    slug: "llama-3.3-70b",
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    slug: "llama-4-scout",
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    slug: "gpt-oss-120b",
  },
];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, "..");
const resultsRoot = resolve(
  spikeRoot,
  "..",
  "..",
  "tmp",
  "phase-14.5-sheet-benchmark",
);
const wranglerBin = resolve(
  spikeRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

export function readRawFlag(argv: readonly string[]): boolean {
  return argv.includes("--raw");
}

export function readPortArg(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? argv[index + 1] : undefined;
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 8797;
}

export type ModelFilter =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly model: ModelEntry }
  | { readonly kind: "invalid"; readonly error: string };

export function readModelFilter(argv: readonly string[]): ModelFilter {
  const index = argv.indexOf("--model");
  if (index < 0) {
    return { kind: "absent" };
  }
  const id = argv[index + 1];
  if (id === undefined) {
    return { kind: "invalid", error: "--model requires a model id" };
  }
  const model = MODELS.find((entry) => entry.id === id);
  if (model === undefined) {
    return {
      kind: "invalid",
      error: `unknown model "${id}"; expected one of: ${MODELS.map((entry) => entry.id).join(", ")}`,
    };
  }
  return { kind: "present", model };
}

export type FixtureFilter =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly fixture: SheetBenchmarkFixture }
  | { readonly kind: "invalid"; readonly error: string };

export function readFixtureFilter(
  argv: readonly string[],
  fixtures: readonly SheetBenchmarkFixture[],
): FixtureFilter {
  const index = argv.indexOf("--fixture");
  if (index < 0) {
    return { kind: "absent" };
  }
  const id = argv[index + 1];
  if (id === undefined) {
    return { kind: "invalid", error: "--fixture requires a fixture id" };
  }
  const fixture = fixtures.find((entry) => entry.id === id);
  if (fixture === undefined) {
    return {
      kind: "invalid",
      error: `unknown fixture "${id}"; expected one of: ${fixtures.map((entry) => entry.id).join(", ")}`,
    };
  }
  return { kind: "present", fixture };
}

export type PersonaFilter =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly personas: readonly PersonaSlug[] }
  | { readonly kind: "invalid"; readonly error: string };

export function readPersonaFilter(argv: readonly string[]): PersonaFilter {
  const slugs: PersonaSlug[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--persona") {
      const value = argv[i + 1];
      if (value === undefined) {
        return { kind: "invalid", error: "--persona requires a persona slug" };
      }
      if (!isValidPersonaSlug(value)) {
        return {
          kind: "invalid",
          error: `unknown persona "${value}"; expected one of: ${PERSONA_SLUGS.join(", ")}`,
        };
      }
      slugs.push(value);
      i++;
    }
  }
  if (slugs.length === 0) {
    return { kind: "absent" };
  }
  return { kind: "present", personas: slugs };
}

export interface BenchmarkSelection {
  readonly models: readonly ModelEntry[];
  readonly fixtures: readonly SheetBenchmarkFixture[];
  readonly personas: readonly PersonaSlug[];
}

/**
 * Resolves the CLI selection before any wrangler/dev server starts. An unknown
 * model, fixture, or persona throws here, so invalid invocations never reach
 * remote inference.
 */
export function resolveSelection(
  argv: readonly string[],
  fixtures: readonly SheetBenchmarkFixture[] = SHEET_BENCHMARK_FIXTURES,
): BenchmarkSelection {
  const modelFilter = readModelFilter(argv);
  if (modelFilter.kind === "invalid") {
    throw new Error(modelFilter.error);
  }
  const fixtureFilter = readFixtureFilter(argv, fixtures);
  if (fixtureFilter.kind === "invalid") {
    throw new Error(fixtureFilter.error);
  }
  const personaFilter = readPersonaFilter(argv);
  if (personaFilter.kind === "invalid") {
    throw new Error(personaFilter.error);
  }
  return {
    models: modelFilter.kind === "present" ? [modelFilter.model] : MODELS,
    fixtures:
      fixtureFilter.kind === "present" ? [fixtureFilter.fixture] : fixtures,
    personas: personaFilter.kind === "present" ? personaFilter.personas : [],
  };
}

interface ModelRun {
  readonly model: string;
  readonly slug: string;
  readonly results: readonly FixtureRunResult[];
  readonly acceptances: readonly {
    fixtureId: string;
    persona: PersonaSlug | null;
    report: AcceptanceReport;
  }[];
  readonly metrics: ModelBenchmarkMetrics;
}

async function main(): Promise<void> {
  const rawFlag = readRawFlag(process.argv);
  const port = readPortArg(process.argv);
  const selection = resolveSelection(process.argv);

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
      "sheet-benchmark/wrangler.jsonc",
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
      `Wrangler ready on port ${port}. Results: ${outDir}\nFixtures: ${selection.fixtures.length}, models: ${selection.models.map((m) => m.slug).join(", ")}${selection.personas.length > 0 ? `, personas: ${selection.personas.join(", ")}` : ""}\n`,
    );

    const modelRuns: ModelRun[] = [];

    for (const model of selection.models) {
      process.stdout.write(`${model.slug}…`);
      const results: FixtureRunResult[] = [];
      const acceptances: ModelRun["acceptances"][number][] = [];

      const fixturePort = new RemoteSheetGenerationPort(baseUrl, model.id);
      for (const fixture of selection.fixtures) {
        const personasToRun =
          selection.personas.length > 0 ? selection.personas : [undefined];

        for (const persona of personasToRun) {
          const input: {
            readonly fixture: SheetBenchmarkFixture;
            readonly port: RemoteSheetGenerationPort;
            readonly persona?: PersonaSlug;
          } =
            persona !== undefined
              ? { fixture, port: fixturePort, persona }
              : { fixture, port: fixturePort };
          const result = await runFixtureThroughPipeline(input);
          const report = evaluateFixtureAcceptance(fixture, result);
          results.push(result);
          acceptances.push({
            fixtureId: fixture.id,
            persona: persona ?? null,
            report,
          });

          const personaSuffix = persona !== undefined ? `.${persona}` : "";
          await writeFile(
            join(outDir, `${model.slug}.${fixture.id}${personaSuffix}.json`),
            `${JSON.stringify({ model: model.id, fixtureId: fixture.id, persona: persona ?? null, result, acceptance: report }, null, 2)}\n`,
          );

          if (rawFlag && !report.passed) {
            printFailingRaw(fixture, result);
          }
        }
      }

      const metrics = computeModelMetrics(
        model.id,
        results,
        selection.fixtures,
      );
      modelRuns.push({
        model: model.id,
        slug: model.slug,
        results,
        acceptances,
        metrics,
      });

      await writeFile(
        join(outDir, `${model.slug}.summary.json`),
        `${JSON.stringify({ model: model.id, metrics, acceptances }, null, 2)}\n`,
      );

      const passCount = metrics.fixturesPassed;
      const passRate = Math.round(metrics.passRate * 100);
      console.log(
        `  ${passCount}/${metrics.fixturesAttempted} accepted (${passRate}%)  calls=${metrics.totalCalls} (first ${metrics.firstAttempts}, replays ${metrics.correctionReplays}: ok ${metrics.correctionSuccesses}/fail ${metrics.correctionFailures})  total=${metrics.totalElapsedMs}ms`,
      );
    }

    printTable(selection.fixtures, modelRuns, selection.personas);
    await writeFile(
      join(outDir, "summary.json"),
      `${JSON.stringify({ runId, models: modelRuns.map(runToSummary) }, null, 2)}\n`,
    );
    await writeFile(
      join(outDir, "summary.md"),
      renderMarkdown(
        selection.models,
        selection.fixtures,
        modelRuns,
        selection.personas,
      ),
      "utf8",
    );
    console.log(`\nFull results: ${outDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    throw new Error(`${message}\n${output.join("").slice(-6_000)}`);
  } finally {
    await stop(child);
  }
}

function runToSummary(modelRun: ModelRun): object {
  return {
    model: modelRun.model,
    slug: modelRun.slug,
    fixturesPassed: modelRun.metrics.fixturesPassed,
    fixturesAttempted: modelRun.metrics.fixturesAttempted,
    passRate: modelRun.metrics.passRate,
    totalCalls: modelRun.metrics.totalCalls,
    plannedCalls: modelRun.metrics.plannedCalls,
    firstAttempts: modelRun.metrics.firstAttempts,
    correctionReplays: modelRun.metrics.correctionReplays,
    correctionSuccesses: modelRun.metrics.correctionSuccesses,
    correctionFailures: modelRun.metrics.correctionFailures,
    perStageAttempts: modelRun.metrics.perStageAttempts,
    totalElapsedMs: modelRun.metrics.totalElapsedMs,
    perStage: modelRun.metrics.perStage,
    localeVerdicts: modelRun.metrics.localeVerdicts,
    fixtures: modelRun.acceptances.map((entry) => ({
      fixtureId: entry.fixtureId,
      persona: entry.persona,
      passed: entry.report.passed,
      taxonomy: entry.report.taxonomy,
      checks: entry.report.checks,
    })),
  };
}

function printFailingRaw(
  fixture: SheetBenchmarkFixture,
  result: FixtureRunResult,
): void {
  console.log(`    raw diagnostics for fixture ${fixture.id}:`);
  const byStage = new Map<string, string[]>();
  for (const call of result.calls) {
    const list = byStage.get(call.stage) ?? [];
    list.push(call.raw);
    byStage.set(call.stage, list);
  }
  for (const [stage, raws] of byStage) {
    for (const raw of raws) {
      const preview = raw.slice(0, 240).replace(/\s+/g, " ");
      console.log(`      [${stage}] ${preview}${raw.length > 240 ? "…" : ""}`);
    }
  }
}

function printTable(
  fixtures: readonly SheetBenchmarkFixture[],
  modelRuns: ModelRun[],
  personas: readonly PersonaSlug[],
): void {
  if (modelRuns.length === 0) {
    console.log("\nNo models benchmarked.\n");
    return;
  }

  console.log("\n=== COMPARISON TABLE ===\n");

  if (personas.length > 0) {
    const header = [
      "Model",
      "Accepted",
      "Calls",
      "Replays",
      "Total ms",
      ...personas,
    ];
    const rows = modelRuns.map((run) => {
      const byPersona = new Map(
        run.acceptances.map((entry) => [
          entry.persona ?? "baseline",
          entry.report.passed,
        ]),
      );
      return [
        run.slug,
        `${run.metrics.fixturesPassed}/${run.metrics.fixturesAttempted}`,
        String(run.metrics.totalCalls),
        `${run.metrics.correctionReplays} (ok ${run.metrics.correctionSuccesses}/fail ${run.metrics.correctionFailures})`,
        String(run.metrics.totalElapsedMs),
        ...personas.map((p) => (byPersona.get(p) === true ? "ok" : "FAIL")),
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
  } else {
    const fixtureIds = fixtures.map((f) => f.id);
    const header = [
      "Model",
      "Accepted",
      "Calls",
      "Replays",
      "Total ms",
      ...fixtureIds,
    ];
    const rows = modelRuns.map((run) => {
      const byFixture = new Map(
        run.acceptances.map((entry) => [entry.fixtureId, entry.report.passed]),
      );
      return [
        run.slug,
        `${run.metrics.fixturesPassed}/${run.metrics.fixturesAttempted}`,
        String(run.metrics.totalCalls),
        `${run.metrics.correctionReplays} (ok ${run.metrics.correctionSuccesses}/fail ${run.metrics.correctionFailures})`,
        String(run.metrics.totalElapsedMs),
        ...fixtureIds.map((id) => (byFixture.get(id) === true ? "ok" : "FAIL")),
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
  }
  console.log();
}

function renderMarkdown(
  models: readonly ModelEntry[],
  fixtures: readonly SheetBenchmarkFixture[],
  modelRuns: ModelRun[],
  personas: readonly PersonaSlug[],
): string {
  const lines: string[] = [];
  lines.push(`# Character-sheet generation model benchmark`);
  lines.push("");
  lines.push(`Run: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    `Production pipeline: sections -> fields -> calculations -> compile, `,
  );
  lines.push(`through the real @repo/character-sheet-generation services.`);
  lines.push(
    `Request shape: role-separated messages, max_tokens 8192, per-stage json_schema.`,
  );
  lines.push("");
  lines.push(
    `Fixtures: ${fixtures.length} (8 semantic + 1 prompt-injection probe).`,
  );
  if (personas.length > 0) {
    lines.push(`Personas: ${personas.join(", ")}.`);
  }
  lines.push("");
  lines.push(`## Fixtures`);
  lines.push("");
  lines.push(`| id | role | lang | calc | concepts |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const fixture of fixtures) {
    lines.push(
      `| ${fixture.id} | ${fixture.role} | ${fixture.language} | ` +
        `${fixture.expectedCalculatedCount} | ${fixture.requiredConceptGroups.length} groups |`,
    );
  }
  lines.push("");
  lines.push(`## Results`);
  lines.push("");
  lines.push(
    `| model | accepted | calls | first | replays (ok/fail) | total ms |`,
  );
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const run of modelRuns) {
    lines.push(
      `| ${run.model} | ${run.metrics.fixturesPassed}/${run.metrics.fixturesAttempted} ` +
        `(${Math.round(run.metrics.passRate * 100)}%) | ${run.metrics.totalCalls} | ` +
        `${run.metrics.firstAttempts} | ${run.metrics.correctionReplays} ` +
        `(${run.metrics.correctionSuccesses}/${run.metrics.correctionFailures}) | ` +
        `${run.metrics.totalElapsedMs} |`,
    );
  }
  lines.push("");
  lines.push(`### Per-fixture acceptance`);
  lines.push("");

  if (personas.length > 0) {
    lines.push(`| model | ${personas.join(" | ")} |`);
    lines.push(`| --- | ${personas.map(() => "---").join(" | ")} |`);
    for (const run of modelRuns) {
      const byPersona = new Map(
        run.acceptances.map((entry) => [
          entry.persona ?? "baseline",
          entry.report.passed,
        ]),
      );
      const cells = personas.map((p) =>
        byPersona.get(p) === true ? "ok" : "FAIL",
      );
      lines.push(`| ${run.model} | ${cells.join(" | ")} |`);
    }
  } else {
    lines.push(`| model | ${fixtures.map((f) => f.id).join(" | ")} |`);
    lines.push(`| --- | ${fixtures.map(() => "---").join(" | ")} |`);
    for (const run of modelRuns) {
      const byFixture = new Map(
        run.acceptances.map((entry) => [entry.fixtureId, entry.report.passed]),
      );
      const cells = fixtures.map((f) =>
        byFixture.get(f.id) === true ? "ok" : "FAIL",
      );
      lines.push(`| ${run.model} | ${cells.join(" | ")} |`);
    }
  }
  lines.push("");
  lines.push(`Raw per-fixture JSON and per-model summaries: ${resultsRoot}`);
  lines.push("");
  lines.push(
    `This run consumed live Cloudflare Workers AI inference for ${models.length} candidate models.`,
  );
  return lines.join("\n");
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
