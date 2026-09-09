import { RULES_EMBEDDING_DIMENSIONS } from "../model.js";
import type {
  ChunkSourcePort,
  EmbeddingsPort,
  RetrievalRecord,
  RetrievedVector,
  RuleAnalysisPort,
  RuleVectorIndexPort,
  RulebookFileHashPort,
  RunArtifactPort,
  VectorRecord,
} from "../ports.js";
import type {
  RunClaimResult,
  RunCreationResult,
  RulesAnalysisRunRepositoryPort,
} from "../repository.js";
import {
  type RuleBuildFailureCode,
  type RulesAnalysisInputArtifact,
  type RulesAnalysisRun,
} from "../model.js";
import type { RulebookChunk } from "@repo/rulebook-ingestion";
import type { RulesContext } from "@repo/rules-context";

export function createFakeEmbeddings(): EmbeddingsPort {
  return {
    async embed(texts) {
      return texts.map((text) => deterministicVector(text));
    },
  };
}

export function deterministicVector(text: string): number[] {
  const values = new Array<number>(RULES_EMBEDDING_DIMENSIONS).fill(1);
  let seed = 0;
  for (const char of text) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  values[0] = (seed % 251) / 1000;
  return values;
}

export interface FakeVectorIndexState {
  vectors: Map<string, Map<string, readonly number[]>>;
  upserts: Array<{ namespace: string; vectors: readonly VectorRecord[] }>;
  queries: Array<{
    namespace: string;
    vector: readonly number[];
    topK: number;
  }>;
  deletions: Array<{ namespace: string; ids: readonly string[] }>;
}

export function createFakeVectorIndex(
  state: FakeVectorIndexState = {
    vectors: new Map(),
    upserts: [],
    queries: [],
    deletions: [],
  },
): RuleVectorIndexPort & {
  state: FakeVectorIndexState;
  scriptQuery(ids: readonly string[]): void;
  failNextUpsert(): void;
  failNextQuery(): void;
} {
  let failUpsert = false;
  let failQuery = false;
  const queryScripts: Array<readonly string[]> = [];

  const index: RuleVectorIndexPort & {
    state: FakeVectorIndexState;
    scriptQuery(ids: readonly string[]): void;
    failNextUpsert(): void;
    failNextQuery(): void;
  } = {
    state,
    async upsert(input) {
      if (failUpsert) {
        failUpsert = false;
        throw new Error("upsert failed");
      }
      state.upserts.push(input);
      let namespaceVectors = state.vectors.get(input.namespace);
      if (namespaceVectors === undefined) {
        namespaceVectors = new Map<string, readonly number[]>();
        state.vectors.set(input.namespace, namespaceVectors);
      }
      for (const vector of input.vectors) {
        namespaceVectors.set(vector.id, vector.values);
      }
    },
    async query(input) {
      if (failQuery) {
        failQuery = false;
        throw new Error("query failed");
      }
      state.queries.push(input);
      const scripted = queryScripts.shift();
      const ids = scripted ?? [];
      return ids.map((id): RetrievedVector => ({ id }));
    },
    async deleteByIds(input) {
      state.deletions.push({ namespace: input.namespace, ids: [...input.ids] });
      const namespaceVectors = state.vectors.get(input.namespace);
      if (namespaceVectors !== undefined) {
        for (const id of input.ids) {
          namespaceVectors.delete(id);
        }
      }
    },
    scriptQuery(ids) {
      queryScripts.push(ids);
    },
    failNextUpsert() {
      failUpsert = true;
    },
    failNextQuery() {
      failQuery = true;
    },
  };
  return index;
}

export function createScriptedAnalysis(
  responses: readonly string[],
): RuleAnalysisPort & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  let next = 0;
  return {
    calls,
    async generate(input) {
      calls.push({ system: input.system, user: input.user });
      const response = responses[next];
      next += 1;
      if (response === undefined) {
        throw new Error("Unexpected extra analysis call.");
      }
      if (response.startsWith("THROW:")) {
        throw new Error(response.slice("THROW:".length));
      }
      return response;
    },
  };
}

export function createFakeChunkSource(
  chunks: readonly RulebookChunk[],
): ChunkSourcePort & { reads: number } {
  let reads = 0;
  return {
    reads,
    async readChunks() {
      reads += 1;
      return chunks;
    },
  };
}

export function createFakeFileHash(
  hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
): RulebookFileHashPort {
  return {
    async hashRulebookRaw() {
      return hash;
    },
  };
}

export interface FakeArtifactState {
  inputs: Map<string, RulesAnalysisInputArtifact>;
  contexts: Array<{
    analysisId: string;
    ingestionId: string;
    runId: string;
    context: unknown;
  }>;
  retrieval: Array<{
    analysisId: string;
    ingestionId: string;
    runId: string;
    retrieval: RetrievalRecord;
  }>;
  manifests: Map<string, readonly string[]>;
  deletions: Array<{
    analysisId: string;
    ingestionId: string;
    runId: string;
  }>;
}

export function createFakeRunArtifacts(
  state: FakeArtifactState = {
    inputs: new Map(),
    contexts: [],
    retrieval: [],
    manifests: new Map(),
    deletions: [],
  },
): RunArtifactPort & { state: FakeArtifactState } {
  return {
    state,
    async putInput(input) {
      state.inputs.set(input.runId, {
        version: 1,
        runId: input.runId,
        analysisId: input.analysisId,
        ingestionId: input.ingestionId,
        characterIntent: input.characterIntent,
        ruleOverrides: [...input.ruleOverrides],
      });
    },
    async getInput(input) {
      return state.inputs.get(input.runId) ?? null;
    },
    async putContext(input) {
      state.contexts.push(input);
    },
    async getContext({ analysisId, ingestionId, runId }) {
      for (let index = state.contexts.length - 1; index >= 0; index -= 1) {
        const stored = state.contexts[index];
        if (
          stored !== undefined &&
          stored.analysisId === analysisId &&
          stored.ingestionId === ingestionId &&
          stored.runId === runId
        ) {
          return stored.context as RulesContext;
        }
      }
      return null;
    },
    async putRetrieval(input) {
      state.retrieval.push(input);
    },
    async putVectorManifest(input) {
      state.manifests.set(input.runId, [...input.vectorIds]);
    },
    async getVectorManifest(input) {
      return state.manifests.get(input.runId) ?? null;
    },
    async deleteRunArtifacts(input) {
      state.deletions.push(input);
      state.inputs.delete(input.runId);
      state.manifests.delete(input.runId);
      state.contexts = state.contexts.filter(
        (stored) => stored.runId !== input.runId,
      );
      state.retrieval = state.retrieval.filter(
        (stored) => stored.runId !== input.runId,
      );
    },
  };
}

export class FakeRunRepository implements RulesAnalysisRunRepositoryPort {
  readonly runs = new Map<string, RulesAnalysisRun>();
  readonly currentByAnalysis = new Map<string, string>();

  async createCurrent(run: RulesAnalysisRun): Promise<RunCreationResult> {
    const existingRunId = this.currentByAnalysis.get(run.analysisId);
    if (
      existingRunId !== undefined &&
      this.runs.get(existingRunId)?.isCurrent === true
    ) {
      const existing = this.runs.get(existingRunId);
      if (existing !== undefined && existing.status !== "FAILED") {
        return "superseded";
      }
    }
    if (existingRunId !== undefined) {
      const existing = this.runs.get(existingRunId);
      if (existing !== undefined) {
        this.runs.set(existingRunId, { ...existing, isCurrent: false });
      }
    }
    this.runs.set(run.runId, { ...run, isCurrent: true });
    this.currentByAnalysis.set(run.analysisId, run.runId);
    return "created_current";
  }

  async findCurrent(analysisId: string) {
    const runId = this.currentByAnalysis.get(analysisId);
    if (runId === undefined) {
      return null;
    }
    const run = this.runs.get(runId);
    return run !== undefined && run.isCurrent
      ? run
      : this.findCurrentRow(analysisId);
  }

  private findCurrentRow(analysisId: string) {
    for (const run of this.runs.values()) {
      if (run.analysisId === analysisId && run.isCurrent) {
        return run;
      }
    }
    return null;
  }

  async findRun(analysisId: string, runId: string) {
    const run = this.runs.get(runId);
    return run === undefined || run.analysisId !== analysisId ? null : run;
  }

  supersede(analysisId: string, run: RulesAnalysisRun): void {
    const existingRunId = this.currentByAnalysis.get(analysisId);
    if (existingRunId !== undefined) {
      const existing = this.runs.get(existingRunId);
      if (existing !== undefined) {
        this.runs.set(existingRunId, { ...existing, isCurrent: false });
      }
    }
    this.runs.set(run.runId, {
      ...run,
      analysisId,
      isCurrent: true,
    });
    this.currentByAnalysis.set(analysisId, run.runId);
  }

  async claimRunningIfCurrent(
    runId: string,
    analysisId: string,
    ingestionId: string,
  ): Promise<RunClaimResult> {
    const run = this.runs.get(runId);
    if (run === undefined) {
      return "not_current";
    }
    if (
      run.analysisId !== analysisId ||
      run.ingestionId !== ingestionId ||
      !run.isCurrent ||
      (run.status !== "QUEUED" && run.status !== "RUNNING")
    ) {
      return "not_current";
    }
    this.runs.set(runId, {
      ...run,
      status: "RUNNING",
      updatedAt: run.updatedAt,
    });
    return "claimed";
  }

  async finalizeIfCurrent(
    runId: string,
    input: {
      status: "READY" | "CONFLICTS" | "CONFIRMED";
      updatedAt: Date;
    },
  ) {
    const run = this.runs.get(runId);
    if (run === undefined || !run.isCurrent) {
      return false;
    }
    this.runs.set(runId, {
      ...run,
      status: input.status,
      updatedAt: input.updatedAt,
    });
    return true;
  }

  async markFailedIfCurrent(
    runId: string,
    failureCode: RuleBuildFailureCode,
    updatedAt: Date,
  ) {
    const run = this.runs.get(runId);
    if (run === undefined || !run.isCurrent) {
      return false;
    }
    this.runs.set(runId, {
      ...run,
      status: "FAILED",
      failureCode,
      updatedAt,
    });
    return true;
  }

  async confirmIfCurrent(
    runId: string,
    input: {
      analysisId: string;
      ingestionId: string;
      updatedAt: Date;
    },
  ) {
    const run = this.runs.get(runId);
    if (
      run === undefined ||
      !run.isCurrent ||
      run.analysisId !== input.analysisId ||
      run.ingestionId !== input.ingestionId ||
      run.status !== "CONFLICTS"
    ) {
      return false;
    }
    this.runs.set(runId, {
      ...run,
      status: "CONFIRMED",
      updatedAt: input.updatedAt,
    });
    return true;
  }

  async markInvalidatedIfCurrent(runId: string, updatedAt: Date) {
    const run = this.runs.get(runId);
    if (run === undefined || !run.isCurrent) {
      return false;
    }
    this.runs.set(runId, {
      ...run,
      status: "INVALIDATED",
      isCurrent: false,
      updatedAt,
    });
    return true;
  }

  async invalidateRunsForGeneration(analysisId: string, ingestionId: string) {
    const affected: RulesAnalysisRun[] = [];
    for (const [runId, run] of this.runs) {
      if (
        run.analysisId !== analysisId ||
        run.ingestionId !== ingestionId ||
        run.status === "INVALIDATED" ||
        run.status === "FAILED"
      ) {
        continue;
      }
      const updated: RulesAnalysisRun = {
        ...run,
        status: "INVALIDATED",
        isCurrent: false,
      };
      this.runs.set(runId, updated);
      if (this.currentByAnalysis.get(analysisId) === runId) {
        this.currentByAnalysis.delete(analysisId);
      }
      affected.push(updated);
    }
    return affected;
  }

  async listForAnalysis(analysisId: string) {
    return [...this.runs.values()].filter(
      (run) => run.analysisId === analysisId,
    );
  }

  async deleteAllForAnalysis(analysisId: string) {
    for (const [runId, run] of this.runs) {
      if (run.analysisId === analysisId) {
        this.runs.delete(runId);
      }
    }
    this.currentByAnalysis.delete(analysisId);
  }
}
