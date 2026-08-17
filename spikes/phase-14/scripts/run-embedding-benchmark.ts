import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchmarkDocuments,
  benchmarkQueries,
  expectedDocumentIds,
} from "../embeddings/corpus.js";
import { evaluateEmbeddingBenchmark } from "../embeddings/metrics.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, "..");
const wranglerBin = resolve(
  spikeRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const port = 8796;
const baseUrl = `http://127.0.0.1:${port}`;

const MODELS = [
  "@cf/baai/bge-m3",
  "@cf/google/embeddinggemma-300m",
  "@cf/qwen/qwen3-embedding-0.6b",
] as const;

interface BenchmarkResult {
  readonly model: string;
  readonly available: boolean;
  readonly dimensions?: number;
  readonly top1Accuracy?: number;
  readonly top3Accuracy?: number;
  readonly crossLanguageTop1Accuracy?: number;
  readonly crossLanguageTop3Accuracy?: number;
  readonly meanReciprocalRank?: number;
  readonly recallAt3?: number;
  readonly averageRelevantSimilarity?: number;
  readonly averageDistractorSeparation?: number;
  readonly latencyMs?: number;
  readonly error?: string;
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
  console.log(`Wrangler ready on port ${port}. Running benchmark…\n`);

  const docTexts = benchmarkDocuments.map((d) => d.text);
  const queryTexts = benchmarkQueries.map((q) => q.text);

  console.log(
    `Corpus: ${benchmarkDocuments.length} documents, ${benchmarkQueries.length} queries`,
  );
  console.log(`Models: ${MODELS.join(", ")}\n`);

  const results: BenchmarkResult[] = [];

  for (const model of MODELS) {
    const result = await benchmarkModel(model, docTexts, queryTexts);
    results.push(result);

    if (!result.available) {
      console.log(`  ✗ unavailable: ${result.error ?? "unknown error"}`);
    } else {
      console.log(
        `  ${result.dimensions}d  top1=${(result.top1Accuracy ?? 0) * 100}%  top3=${(result.top3Accuracy ?? 0) * 100}%  ` +
          `cross1=${(result.crossLanguageTop1Accuracy ?? 0) * 100}%  cross3=${(result.crossLanguageTop3Accuracy ?? 0) * 100}%  ` +
          `MRR=${result.meanReciprocalRank?.toFixed(4)}  R@3=${result.recallAt3?.toFixed(4)}  ` +
          `relSim=${result.averageRelevantSimilarity?.toFixed(4)}  ` +
          `distrSep=${result.averageDistractorSeparation?.toFixed(4)}  ` +
          `latency=${result.latencyMs}ms`,
      );
    }
  }

  printTable(results);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  throw new Error(`${message}\n${output.join("").slice(-6_000)}`);
} finally {
  await stop(child);
}

async function benchmarkModel(
  model: string,
  docTexts: string[],
  queryTexts: string[],
): Promise<BenchmarkResult> {
  process.stdout.write(`  ${model}…`);

  const startedAt = performance.now();

  try {
    const docResult = await embedBatch(model, docTexts);
    const queryResult = await embedBatch(model, queryTexts);
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!docResult.success || !queryResult.success) {
      return {
        model,
        available: false,
        latencyMs,
        error: docResult.error ?? queryResult.error ?? "unknown",
      };
    }

    const docEmbeddings = docResult.data!;
    const queryEmbeddings = queryResult.data!;

    const metrics = evaluateEmbeddingBenchmark(
      benchmarkDocuments,
      benchmarkQueries,
      docEmbeddings,
      queryEmbeddings,
    );

    return {
      model,
      available: true,
      latencyMs,
      ...metrics,
    };
  } catch (error) {
    return {
      model,
      available: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

interface EmbedResponse {
  success: boolean;
  dimensions?: number;
  data?: number[][];
  elapsedMs?: number;
  error?: string;
  errorName?: string;
  errorMessage?: string;
}

async function embedBatch(
  model: string,
  texts: string[],
): Promise<EmbedResponse> {
  const response = await fetch(`${baseUrl}/ai/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, texts }),
  });

  const body = (await response.json()) as EmbedResponse;
  return body;
}

function printTable(results: BenchmarkResult[]): void {
  const available = results.filter((r) => r.available);
  if (available.length === 0) {
    console.log("\nNo models available.\n");
    return;
  }

  console.log("\n=== COMPARISON TABLE ===\n");

  const header = [
    "Model",
    "Dims",
    "Top-1",
    "Top-3",
    "Cross-1",
    "Cross-3",
    "MRR",
    "R@3",
    "RelSim",
    "DistrSep",
    "Latency",
  ];
  const rows = available.map((r) => [
    r.model.replace("@cf/", ""),
    String(r.dimensions ?? "?"),
    `${(r.top1Accuracy ?? 0) * 100}%`,
    `${(r.top3Accuracy ?? 0) * 100}%`,
    `${(r.crossLanguageTop1Accuracy ?? 0) * 100}%`,
    `${(r.crossLanguageTop3Accuracy ?? 0) * 100}%`,
    (r.meanReciprocalRank ?? 0).toFixed(4),
    (r.recallAt3 ?? 0).toFixed(4),
    (r.averageRelevantSimilarity ?? 0).toFixed(4),
    (r.averageDistractorSeparation ?? 0).toFixed(4),
    `${r.latencyMs}ms`,
  ]);

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
