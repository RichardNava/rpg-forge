import type {
  AnalysisResourceCleanerPort,
  AnalysisSession,
  Clock,
  HumanVerificationPort,
  RateLimitPort,
  RateLimitResult,
  RepositoryTransition,
  SessionCrypto,
  SessionRepositoryPort,
  VerificationResult,
} from "@repo/rules-analysis-session";
import type {
  ExtractionArtifact,
  RulebookDeletionTransition,
  RulebookFailureCode,
  RulebookIngestion,
  RulebookProcessingTransition,
  RulebookProcessingWorkflowPort,
  RulebookRepositoryPort,
  TemporaryRulebookStoragePort,
} from "@repo/rulebook-ingestion";
import type {
  RetrievalRecord,
  RetrievedVector,
  RuleBuildFailureCode,
  RulesAnalysisInputArtifact,
  RulesAnalysisRun,
  RulesAnalysisRunRepositoryPort,
  RunArtifactPort,
  RunClaimResult,
  RunCreationResult,
  RuleVectorIndexPort,
  VectorRecord,
} from "@repo/rules-analysis-run";
import type {
  CharacterIntent,
  RuleOverride,
  RulesContext,
} from "@repo/rules-context";
import type {
  SheetSessionRepositoryPort,
  DraftHeadRepositoryPort,
  SheetSession,
  DraftHead,
  DraftHeadIdentity,
  DraftHeadStableView,
  DraftHeadClaimResult,
  DraftHeadCommitResult,
  DraftHeadReleaseResult,
  CreateDraftHeadResult,
} from "@repo/character-sheet-session";
import { toDraftHeadStableView } from "@repo/character-sheet-session";
import type {
  CharacterSheetDraft,
  CharacterSheetDraftStore,
  CharacterSheetDraftIdentity,
} from "@repo/character-sheet-draft";
import type { RulesAnalysisWorkflowPort } from "../infrastructure/rules-analysis-workflow.js";

export class FakeClock implements Clock {
  private current: Date;
  constructor(iso: string) {
    this.current = new Date(iso);
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeCrypto implements SessionCrypto {
  private sequence = 0;
  uuid(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }
  randomBytes(length: number): Uint8Array {
    this.sequence += 1;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = (this.sequence + i) & 0xff;
    }
    return bytes;
  }
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const prime = 0x01000193;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] ?? 0;
      h1 = Math.imul(h1 ^ b, prime) >>> 0;
      h2 = (Math.imul(h2, 31) + b) >>> 0;
    }
    const filler = "0123456789abcdef".repeat(8);
    return `${h1.toString(16).padStart(8, "0")}${h2
      .toString(16)
      .padStart(8, "0")}${filler.slice(16, 64)}`;
  }
}

export class FakeResourceCleaner implements AnalysisResourceCleanerPort {
  cleaned: string[] = [];
  failOn = new Set<string>();
  async cleanup(analysisId: string): Promise<void> {
    if (this.failOn.has(analysisId)) {
      throw new Error(`cleanup failed for ${analysisId}`);
    }
    this.cleaned.push(analysisId);
  }
}

export class FakeHumanVerification implements HumanVerificationPort {
  calls: string[] = [];
  result: VerificationResult = { kind: "success" };
  async verify(): Promise<VerificationResult> {
    this.calls.push("verify");
    return this.result;
  }
}

export class FakeRateLimiter implements RateLimitPort {
  calls: string[] = [];
  result: RateLimitResult = { kind: "allowed" };
  async consume(key: string): Promise<RateLimitResult> {
    this.calls.push(key);
    return this.result;
  }
}

export class FakeRulebookRepository implements RulebookRepositoryPort {
  readonly rows = new Map<string, RulebookIngestion>();
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async reserve(
    rulebook: RulebookIngestion,
  ): Promise<"reserved" | "already_attached"> {
    if (this.rows.has(rulebook.analysisId)) {
      return "already_attached";
    }
    this.rows.set(rulebook.analysisId, cloneRulebook(rulebook));
    return "reserved";
  }

  async findByAnalysisId(
    analysisId: string,
  ): Promise<RulebookIngestion | null> {
    const row = this.rows.get(analysisId);
    return row === undefined ? null : cloneRulebook(row);
  }

  async findByGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookIngestion | null> {
    const row = this.rows.get(analysisId);
    return row === undefined || row.ingestionId !== ingestionId
      ? null
      : cloneRulebook(row);
  }

  async markQueuedIfUploading(
    analysisId: string,
    ingestionId: string,
    sizeBytes: number,
  ): Promise<boolean> {
    const row = this.rows.get(analysisId);
    if (
      row === undefined ||
      row.ingestionId !== ingestionId ||
      row.status !== "UPLOADING"
    ) {
      return false;
    }
    row.status = "QUEUED";
    row.sizeBytes = sizeBytes;
    row.updatedAt = this.clock.now();
    return true;
  }

  async ensureProcessing(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookProcessingTransition> {
    const row = this.rows.get(analysisId);
    if (row === undefined || row.ingestionId !== ingestionId) {
      return "not_current";
    }
    if (row.status === "PROCESSING") {
      return "already_processing";
    }
    if (row.status !== "QUEUED") {
      return "not_current";
    }
    row.status = "PROCESSING";
    row.updatedAt = this.clock.now();
    return "transitioned";
  }

  async markReadyIfProcessing(input: {
    analysisId: string;
    ingestionId: string;
    pageCount: number;
    chunkCount: number;
    extractedChars: number;
  }): Promise<boolean> {
    const row = this.rows.get(input.analysisId);
    if (
      row === undefined ||
      row.ingestionId !== input.ingestionId ||
      row.status !== "PROCESSING"
    ) {
      return false;
    }
    row.status = "READY";
    row.pageCount = input.pageCount;
    row.chunkCount = input.chunkCount;
    row.extractedChars = input.extractedChars;
    row.failureCode = null;
    row.updatedAt = this.clock.now();
    return true;
  }

  async markFailedIfCurrent(input: {
    analysisId: string;
    ingestionId: string;
    failureCode: RulebookFailureCode;
  }): Promise<boolean> {
    const row = this.rows.get(input.analysisId);
    if (
      row === undefined ||
      row.ingestionId !== input.ingestionId ||
      !["UPLOADING", "QUEUED", "PROCESSING"].includes(row.status)
    ) {
      return false;
    }
    row.status = "FAILED";
    row.failureCode = input.failureCode;
    row.updatedAt = this.clock.now();
    return true;
  }

  async markDeleting(analysisId: string): Promise<RulebookDeletionTransition> {
    const current = this.rows.get(analysisId);
    if (current === undefined) {
      return { kind: "not_found" };
    }
    return this.markDeletingGeneration(analysisId, current.ingestionId);
  }

  async markDeletingGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<RulebookDeletionTransition> {
    const row = this.rows.get(analysisId);
    if (row === undefined || row.ingestionId !== ingestionId) {
      return { kind: "not_found" };
    }
    if (row.status === "DELETING") {
      return { kind: "already_deleting", rulebook: cloneRulebook(row) };
    }
    row.status = "DELETING";
    row.updatedAt = this.clock.now();
    return { kind: "transitioned", rulebook: cloneRulebook(row) };
  }

  async deleteIfGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<void> {
    const row = this.rows.get(analysisId);
    if (row?.ingestionId === ingestionId) {
      this.rows.delete(analysisId);
    }
  }
}

export class FakeRulebookStorage implements TemporaryRulebookStoragePort {
  readonly raw = new Map<string, Uint8Array>();
  readonly extraction = new Map<string, ExtractionArtifact>();
  readonly chunks = new Map<string, string>();
  failOn: "putRaw" | "delete" | undefined;

  async putRaw(input: {
    analysisId: string;
    ingestionId: string;
    bytes: AsyncIterable<Uint8Array>;
  }): Promise<void> {
    if (this.failOn === "putRaw") {
      throw new Error("raw storage failed");
    }
    const parts: Uint8Array[] = [];
    let length = 0;
    for await (const part of input.bytes) {
      parts.push(part);
      length += part.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    this.raw.set(rulebookKey(input.analysisId, input.ingestionId), bytes);
  }

  async openRaw(): Promise<never> {
    throw new Error("not used by HTTP tests");
  }

  async putExtraction(input: {
    analysisId: string;
    ingestionId: string;
    artifact: ExtractionArtifact;
  }): Promise<void> {
    this.extraction.set(
      rulebookKey(input.analysisId, input.ingestionId),
      structuredClone(input.artifact),
    );
  }

  async putChunks(input: {
    analysisId: string;
    ingestionId: string;
    jsonl: string;
  }): Promise<void> {
    this.chunks.set(
      rulebookKey(input.analysisId, input.ingestionId),
      input.jsonl,
    );
  }

  async deleteArtifacts(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<void> {
    if (this.failOn === "delete") {
      throw new Error("cleanup failed");
    }
    const key = rulebookKey(input.analysisId, input.ingestionId);
    this.raw.delete(key);
    this.extraction.delete(key);
    this.chunks.delete(key);
  }
}

export class FakeRulebookWorkflow implements RulebookProcessingWorkflowPort {
  readonly started: string[] = [];
  readonly terminated: string[] = [];
  failOnStart = false;
  failOnTerminate = false;

  async start(input: {
    analysisId: string;
    ingestionId: string;
  }): Promise<void> {
    if (this.failOnStart) {
      throw new Error("workflow start failed");
    }
    this.started.push(rulebookKey(input.analysisId, input.ingestionId));
  }

  async terminate(ingestionId: string): Promise<void> {
    if (this.failOnTerminate) {
      throw new Error("workflow terminate failed");
    }
    this.terminated.push(ingestionId);
  }
}

export class FakeRulesAnalysisRunRepository implements RulesAnalysisRunRepositoryPort {
  readonly rows = new Map<string, RulesAnalysisRun>();

  async createCurrent(run: RulesAnalysisRun): Promise<RunCreationResult> {
    if (this.currentRun(run.analysisId) !== null) {
      return "superseded";
    }
    this.rows.set(run.runId, cloneRun(run));
    return "created_current";
  }

  async findCurrent(analysisId: string): Promise<RulesAnalysisRun | null> {
    const current = this.currentRun(analysisId);
    return current === null ? null : cloneRun(current);
  }

  async findRun(
    analysisId: string,
    runId: string,
  ): Promise<RulesAnalysisRun | null> {
    const run = this.rows.get(runId);
    return run === undefined || run.analysisId !== analysisId
      ? null
      : cloneRun(run);
  }

  async claimRunningIfCurrent(
    runId: string,
    analysisId: string,
    ingestionId: string,
  ): Promise<RunClaimResult> {
    const run = this.rows.get(runId);
    if (
      run === undefined ||
      run.analysisId !== analysisId ||
      run.ingestionId !== ingestionId ||
      !run.isCurrent ||
      run.status !== "QUEUED"
    ) {
      return "not_current";
    }
    run.status = "RUNNING";
    return "claimed";
  }

  async finalizeIfCurrent(
    runId: string,
    input: { status: "READY" | "CONFLICTS" | "CONFIRMED"; updatedAt: Date },
  ): Promise<boolean> {
    const run = this.rows.get(runId);
    if (
      run === undefined ||
      !run.isCurrent ||
      !["RUNNING", "CONFLICTS"].includes(run.status)
    ) {
      return false;
    }
    run.status = input.status;
    run.failureCode = null;
    run.updatedAt = input.updatedAt;
    return true;
  }

  async markFailedIfCurrent(
    runId: string,
    failureCode: RuleBuildFailureCode,
    updatedAt: Date,
  ): Promise<boolean> {
    const run = this.rows.get(runId);
    if (
      run === undefined ||
      !run.isCurrent ||
      !["QUEUED", "RUNNING"].includes(run.status)
    ) {
      return false;
    }
    run.status = "FAILED";
    run.failureCode = failureCode;
    run.updatedAt = updatedAt;
    return true;
  }

  async confirmIfCurrent(
    runId: string,
    input: {
      analysisId: string;
      ingestionId: string;
      updatedAt: Date;
    },
  ): Promise<boolean> {
    const run = this.rows.get(runId);
    if (
      run === undefined ||
      run.analysisId !== input.analysisId ||
      run.ingestionId !== input.ingestionId ||
      !run.isCurrent ||
      run.status !== "CONFLICTS"
    ) {
      return false;
    }
    run.status = "CONFIRMED";
    run.updatedAt = input.updatedAt;
    return true;
  }

  async markInvalidatedIfCurrent(
    runId: string,
    updatedAt: Date,
  ): Promise<boolean> {
    const run = this.rows.get(runId);
    if (run === undefined || !run.isCurrent) {
      return false;
    }
    run.status = "INVALIDATED";
    run.updatedAt = updatedAt;
    return true;
  }

  async invalidateRunsForGeneration(
    analysisId: string,
    ingestionId: string,
  ): Promise<readonly RulesAnalysisRun[]> {
    const affected: RulesAnalysisRun[] = [];
    for (const run of this.rows.values()) {
      if (
        run.analysisId === analysisId &&
        run.ingestionId === ingestionId &&
        run.status !== "FAILED"
      ) {
        affected.push(cloneRun(run));
        run.status = "INVALIDATED";
      }
    }
    return affected;
  }

  async listForAnalysis(
    analysisId: string,
  ): Promise<readonly RulesAnalysisRun[]> {
    const runs: RulesAnalysisRun[] = [];
    for (const run of this.rows.values()) {
      if (run.analysisId === analysisId) {
        runs.push(cloneRun(run));
      }
    }
    return runs;
  }

  async deleteAllForAnalysis(analysisId: string): Promise<void> {
    for (const [runId, run] of this.rows) {
      if (run.analysisId === analysisId) {
        this.rows.delete(runId);
      }
    }
  }

  private currentRun(analysisId: string): RulesAnalysisRun | null {
    for (const run of this.rows.values()) {
      if (run.analysisId === analysisId && run.isCurrent) {
        return run;
      }
    }
    return null;
  }
}

export class FakeRunArtifactStore implements RunArtifactPort {
  readonly inputs = new Map<string, RulesAnalysisInputArtifact>();
  readonly contexts = new Map<string, RulesContext>();
  readonly retrievals = new Map<string, unknown>();
  readonly manifests = new Map<string, readonly string[]>();
  readonly deleted: Array<{
    analysisId: string;
    ingestionId: string;
    runId: string;
  }> = [];
  failOnPutInput = false;

  seedContext(
    input: { analysisId: string; ingestionId: string; runId: string },
    context: RulesContext,
  ): void {
    this.contexts.set(runArtifactKey(input), context);
  }

  seedInput(
    input: { analysisId: string; ingestionId: string; runId: string },
    artifact: RulesAnalysisInputArtifact,
  ): void {
    this.inputs.set(runArtifactKey(input), artifact);
  }

  seedManifest(
    input: { analysisId: string; ingestionId: string; runId: string },
    vectorIds: readonly string[],
  ): void {
    this.manifests.set(runArtifactKey(input), vectorIds);
  }

  async putInput(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    characterIntent: CharacterIntent;
    ruleOverrides: readonly RuleOverride[];
  }): Promise<void> {
    if (this.failOnPutInput) {
      throw new Error("input artifact write failed");
    }
    const artifact: RulesAnalysisInputArtifact = {
      version: 1,
      runId: input.runId,
      analysisId: input.analysisId,
      ingestionId: input.ingestionId,
      characterIntent: input.characterIntent,
      ruleOverrides: [...input.ruleOverrides],
    };
    this.inputs.set(runArtifactKey(input), artifact);
  }

  async getInput(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<RulesAnalysisInputArtifact | null> {
    return this.inputs.get(runArtifactKey(input)) ?? null;
  }

  async putContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    context: RulesContext;
  }): Promise<void> {
    this.contexts.set(runArtifactKey(input), input.context);
  }

  async getContext(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<RulesContext | null> {
    return this.contexts.get(runArtifactKey(input)) ?? null;
  }

  async putRetrieval(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    retrieval: RetrievalRecord;
  }): Promise<void> {
    this.retrievals.set(runArtifactKey(input), input.retrieval);
  }

  async putVectorManifest(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
    vectorIds: readonly string[];
  }): Promise<void> {
    this.manifests.set(runArtifactKey(input), input.vectorIds);
  }

  async getVectorManifest(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<readonly string[] | null> {
    return this.manifests.get(runArtifactKey(input)) ?? null;
  }

  async deleteRunArtifacts(input: {
    analysisId: string;
    ingestionId: string;
    runId: string;
  }): Promise<void> {
    const key = runArtifactKey(input);
    this.inputs.delete(key);
    this.contexts.delete(key);
    this.retrievals.delete(key);
    this.manifests.delete(key);
    this.deleted.push(input);
  }
}

export class FakeVectorIndex implements RuleVectorIndexPort {
  readonly upserted: Array<{ namespace: string; count: number }> = [];
  readonly deleted: Array<{ namespace: string; ids: readonly string[] }> = [];

  async upsert(input: {
    namespace: string;
    vectors: readonly VectorRecord[];
  }): Promise<void> {
    this.upserted.push({
      namespace: input.namespace,
      count: input.vectors.length,
    });
  }

  async query(): Promise<readonly RetrievedVector[]> {
    return [];
  }

  async deleteByIds(input: {
    namespace: string;
    ids: readonly string[];
  }): Promise<void> {
    this.deleted.push({ namespace: input.namespace, ids: [...input.ids] });
  }
}

export class FakeRulesAnalysisWorkflow implements RulesAnalysisWorkflowPort {
  readonly started: Array<{
    analysisId: string;
    ingestionId: string;
    rulesAnalysisRunId: string;
  }> = [];
  readonly terminated: string[] = [];
  failOnStart = false;

  async start(input: {
    analysisId: string;
    ingestionId: string;
    rulesAnalysisRunId: string;
  }): Promise<void> {
    if (this.failOnStart) {
      throw new Error("rules analysis workflow start failed");
    }
    this.started.push(input);
  }

  async terminate(rulesAnalysisRunId: string): Promise<void> {
    this.terminated.push(rulesAnalysisRunId);
  }
}

export class FakeSessionRepository implements SessionRepositoryPort {
  sessions = new Map<string, AnalysisSession>();
  deleteLog: string[] = [];
  createLog: string[] = [];

  async create(session: AnalysisSession): Promise<void> {
    this.createLog.push(session.analysisId);
    this.sessions.set(session.analysisId, clone(session));
  }

  async findById(analysisId: string): Promise<AnalysisSession | null> {
    const session = this.sessions.get(analysisId);
    return session === undefined ? null : clone(session);
  }

  async markDeletingIfActive(
    analysisId: string,
  ): Promise<RepositoryTransition> {
    const session = this.sessions.get(analysisId);
    if (session === undefined) {
      return "not_found";
    }
    if (session.status === "ACTIVE") {
      const next = clone(session);
      next.status = "DELETING";
      this.sessions.set(analysisId, next);
      return "transitioned";
    }
    return "already_deleting";
  }

  async findCleanupCandidates(
    now: Date,
    limit: number,
  ): Promise<AnalysisSession[]> {
    const candidates: AnalysisSession[] = [];
    for (const session of this.sessions.values()) {
      if (
        (session.status === "ACTIVE" &&
          session.expiresAt.getTime() <= now.getTime()) ||
        (session.status === "DELETING" &&
          session.updatedAt.getTime() <= now.getTime() - 60 * 60 * 1000)
      ) {
        candidates.push(clone(session));
      }
      if (candidates.length >= limit) {
        break;
      }
    }
    return candidates;
  }

  async delete(analysisId: string): Promise<void> {
    this.deleteLog.push(analysisId);
    this.sessions.delete(analysisId);
  }
}

function clone(session: AnalysisSession): AnalysisSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt.getTime()),
    updatedAt: new Date(session.updatedAt.getTime()),
    expiresAt: new Date(session.expiresAt.getTime()),
  };
}

function cloneRulebook(rulebook: RulebookIngestion): RulebookIngestion {
  return {
    ...rulebook,
    createdAt: new Date(rulebook.createdAt.getTime()),
    updatedAt: new Date(rulebook.updatedAt.getTime()),
  };
}

function cloneRun(run: RulesAnalysisRun): RulesAnalysisRun {
  return {
    ...run,
    createdAt: new Date(run.createdAt.getTime()),
    updatedAt: new Date(run.updatedAt.getTime()),
  };
}

function rulebookKey(analysisId: string, ingestionId: string): string {
  return `${analysisId}/${ingestionId}`;
}

function runArtifactKey(input: {
  analysisId: string;
  ingestionId: string;
  runId: string;
}): string {
  return `${input.analysisId}/${input.ingestionId}/${input.runId}`;
}

function cloneSheetSession(session: SheetSession): SheetSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt.getTime()),
    updatedAt: new Date(session.updatedAt.getTime()),
    expiresAt: new Date(session.expiresAt.getTime()),
  };
}

export class FakeSheetSessionRepository implements SheetSessionRepositoryPort {
  readonly rows = new Map<string, SheetSession>();
  readonly deleteLog: string[] = [];
  readonly createLog: string[] = [];

  async create(session: SheetSession): Promise<void> {
    this.createLog.push(session.sessionId);
    this.rows.set(session.sessionId, cloneSheetSession(session));
  }

  async findById(sessionId: string): Promise<SheetSession | null> {
    const row = this.rows.get(sessionId);
    return row === undefined ? null : cloneSheetSession(row);
  }

  async markDeletingIfActive(sessionId: string): Promise<RepositoryTransition> {
    const row = this.rows.get(sessionId);
    if (row === undefined) {
      return "not_found";
    }
    if (row.status === "DELETING") {
      return "already_deleting";
    }
    this.rows.set(sessionId, { ...row, status: "DELETING" });
    return "transitioned";
  }

  async findCleanupCandidates(
    now: Date,
    limit: number,
  ): Promise<SheetSession[]> {
    const candidates: SheetSession[] = [];
    for (const row of this.rows.values()) {
      const expired = row.expiresAt.getTime() <= now.getTime();
      if (row.status === "ACTIVE" && expired) {
        candidates.push(cloneSheetSession(row));
      }
      if (candidates.length >= limit) break;
    }
    return candidates;
  }

  async delete(sessionId: string): Promise<void> {
    this.deleteLog.push(sessionId);
    this.rows.delete(sessionId);
  }
}

function cloneDraftHead(head: DraftHead): DraftHead {
  return {
    ...head,
    ...(head.pendingSince === null
      ? {}
      : { pendingSince: new Date(head.pendingSince.getTime()) }),
    createdAt: new Date(head.createdAt.getTime()),
    updatedAt: new Date(head.updatedAt.getTime()),
  };
}

export class FakeDraftHeadRepository implements DraftHeadRepositoryPort {
  readonly rows = new Map<string, DraftHead>();

  private key(identity: DraftHeadIdentity): string {
    return `${identity.sessionId}:${identity.draftId}`;
  }

  async create(identity: DraftHeadIdentity): Promise<CreateDraftHeadResult> {
    const existing = this.rows.get(this.key(identity));
    if (existing !== undefined) {
      return { kind: "already_exists", head: cloneDraftHead(existing) };
    }
    const now = new Date();
    const head: DraftHead = {
      sessionId: identity.sessionId,
      draftId: identity.draftId,
      currentVersion: 1,
      pendingVersion: null,
      pendingClaimId: null,
      pendingSince: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(this.key(identity), head);
    return { kind: "created", head: cloneDraftHead(head) };
  }

  async getHead(identity: DraftHeadIdentity): Promise<DraftHead | null> {
    const head = this.rows.get(this.key(identity));
    return head === undefined ? null : cloneDraftHead(head);
  }

  async getStable(
    identity: DraftHeadIdentity,
  ): Promise<DraftHeadStableView | null> {
    const head = this.rows.get(this.key(identity));
    return head === undefined ? null : toDraftHeadStableView(head);
  }

  async claim(
    identity: DraftHeadIdentity,
    expectedVersion: number,
    claimId: string,
    claimsAt: Date,
  ): Promise<DraftHeadClaimResult> {
    const head = this.rows.get(this.key(identity));
    if (head === undefined) return { kind: "not_found" };
    if (head.pendingVersion !== null) {
      return { kind: "already_pending", head: cloneDraftHead(head) };
    }
    if (head.currentVersion !== expectedVersion) {
      return { kind: "version_conflict", head: cloneDraftHead(head) };
    }
    const claimed: DraftHead = {
      ...head,
      pendingVersion: expectedVersion + 1,
      pendingClaimId: claimId,
      pendingSince: claimsAt,
      updatedAt: claimsAt,
    };
    this.rows.set(this.key(identity), claimed);
    return {
      kind: "claimed",
      head: cloneDraftHead(claimed),
      claimedVersion: expectedVersion + 1,
    };
  }

  async commit(
    identity: DraftHeadIdentity,
    claimId: string,
    expectedCurrentVersion: number,
    committedAt: Date,
  ): Promise<DraftHeadCommitResult> {
    const head = this.rows.get(this.key(identity));
    if (head === undefined) return { kind: "not_found" };
    const nextVersion = expectedCurrentVersion + 1;
    const ownsClaim =
      head.pendingClaimId === claimId &&
      head.pendingVersion === nextVersion &&
      head.currentVersion === expectedCurrentVersion;
    if (!ownsClaim) {
      if (
        head.pendingClaimId !== claimId ||
        head.pendingVersion !== nextVersion
      ) {
        return { kind: "wrong_claim", head: cloneDraftHead(head) };
      }
      return { kind: "version_conflict", head: cloneDraftHead(head) };
    }
    const committed: DraftHead = {
      ...head,
      currentVersion: nextVersion,
      pendingVersion: null,
      pendingClaimId: null,
      pendingSince: null,
      updatedAt: committedAt,
    };
    this.rows.set(this.key(identity), committed);
    return { kind: "committed", head: cloneDraftHead(committed) };
  }

  async release(
    identity: DraftHeadIdentity,
    claimId: string,
    versionToRelease: number,
    releasedAt: Date,
  ): Promise<DraftHeadReleaseResult> {
    const head = this.rows.get(this.key(identity));
    if (head === undefined) return { kind: "not_found" };
    if (
      head.pendingClaimId !== claimId ||
      head.pendingVersion !== versionToRelease
    ) {
      return { kind: "wrong_claim", head: cloneDraftHead(head) };
    }
    const released: DraftHead = {
      ...head,
      pendingVersion: null,
      pendingClaimId: null,
      pendingSince: null,
      updatedAt: releasedAt,
    };
    this.rows.set(this.key(identity), released);
    return { kind: "released", head: cloneDraftHead(released) };
  }

  async findStalePending(
    now: Date,
    staleAfterMs: number,
    limit: number,
  ): Promise<DraftHead[]> {
    const cutoff = now.getTime() - staleAfterMs;
    const candidates: DraftHead[] = [];
    for (const head of this.rows.values()) {
      if (head.pendingSince !== null && head.pendingSince.getTime() <= cutoff) {
        candidates.push(cloneDraftHead(head));
      }
      if (candidates.length >= limit) break;
    }
    return candidates;
  }

  async deleteSessionHeads(sessionId: string): Promise<void> {
    for (const [key, head] of this.rows) {
      if (head.sessionId === sessionId) this.rows.delete(key);
    }
  }
}

function cloneDraft(draft: CharacterSheetDraft): CharacterSheetDraft {
  return structuredClone(draft);
}

export class FakeCharacterSheetDraftStore implements CharacterSheetDraftStore {
  readonly snapshots = new Map<string, CharacterSheetDraft>();
  failOnPutDraft = false;

  private versionKey(
    identity: CharacterSheetDraftIdentity,
    version: number,
  ): string {
    return `${identity.sessionId}:${identity.draftId}:v${version}`;
  }

  private allVersionsKey(identity: CharacterSheetDraftIdentity): string {
    return `${identity.sessionId}:${identity.draftId}`;
  }

  async putDraft(draft: CharacterSheetDraft): Promise<void> {
    if (this.failOnPutDraft) {
      throw new Error("draft snapshot write failed");
    }
    const identity = { sessionId: draft.sessionId, draftId: draft.draftId };
    this.snapshots.set(
      this.versionKey(identity, draft.version),
      cloneDraft(draft),
    );
  }

  async getDraftVersion(
    identity: CharacterSheetDraftIdentity,
    version: number,
  ): Promise<CharacterSheetDraft | null> {
    const draft = this.snapshots.get(this.versionKey(identity, version));
    return draft === undefined ? null : cloneDraft(draft);
  }

  async getLatestDraft(
    identity: CharacterSheetDraftIdentity,
  ): Promise<CharacterSheetDraft | null> {
    const versions = await this.listDraftVersions(identity);
    if (versions.length === 0) return null;
    const latest = versions[versions.length - 1];
    return this.getDraftVersion(identity, latest!);
  }

  async listDraftVersions(
    identity: CharacterSheetDraftIdentity,
  ): Promise<number[]> {
    const versions: number[] = [];
    const prefix = `${identity.sessionId}:${identity.draftId}:v`;
    for (const key of this.snapshots.keys()) {
      if (!key.startsWith(prefix)) continue;
      const versionStr = key.slice(prefix.length);
      const version = Number.parseInt(versionStr, 10);
      if (Number.isFinite(version)) versions.push(version);
    }
    return versions.sort((a, b) => a - b);
  }

  async deleteDraft(identity: CharacterSheetDraftIdentity): Promise<void> {
    const prefix = this.allVersionsKey(identity) + ":";
    for (const key of [...this.snapshots.keys()]) {
      if (key.startsWith(prefix)) this.snapshots.delete(key);
    }
  }
}
