import type {
  Clock,
  RepositoryTransition,
  SessionCrypto,
} from "@repo/rules-analysis-session";
import type { SheetSessionRepositoryPort } from "../sheet-session-repository.js";
import type { SheetRunRepositoryPort } from "../sheet-run-repository.js";
import type { SheetSession } from "../sheet-session.js";
import type {
  RunCleanupCandidate,
  RunTransitionResult,
  SheetGenerationRun,
  SheetRunCreationResult,
  SheetRunFailureCode,
} from "../sheet-run.js";

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
    return `sess-${String(this.sequence).padStart(4, "0")}`;
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

function cloneSession(session: SheetSession): SheetSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt.getTime()),
    updatedAt: new Date(session.updatedAt.getTime()),
    expiresAt: new Date(session.expiresAt.getTime()),
  };
}

export class InMemorySheetSessionRepository implements SheetSessionRepositoryPort {
  readonly rows = new Map<string, SheetSession>();
  readonly deleteLog: string[] = [];

  async create(session: SheetSession): Promise<void> {
    this.rows.set(session.sessionId, cloneSession(session));
  }

  async findById(sessionId: string): Promise<SheetSession | null> {
    const row = this.rows.get(sessionId);
    return row === undefined ? null : cloneSession(row);
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
        candidates.push(cloneSession(row));
      }
      if (candidates.length >= limit) {
        break;
      }
    }
    return candidates;
  }

  async delete(sessionId: string): Promise<void> {
    this.deleteLog.push(sessionId);
    this.rows.delete(sessionId);
  }
}

function cloneRun(run: SheetGenerationRun): SheetGenerationRun {
  return {
    ...run,
    createdAt: new Date(run.createdAt.getTime()),
    updatedAt: new Date(run.updatedAt.getTime()),
    expiresAt: new Date(run.expiresAt.getTime()),
  };
}

/**
 * In-memory reference implementation of the run port used to pin the port
 * contract in Node unit tests; the real D1 adapter is verified in workerd.
 */
export class InMemorySheetRunRepository implements SheetRunRepositoryPort {
  readonly rows = new Map<string, SheetGenerationRun>();

  private currentFor(sessionId: string): SheetGenerationRun | null {
    for (const run of this.rows.values()) {
      if (run.sessionId === sessionId && run.isCurrent) {
        return run;
      }
    }
    return null;
  }

  async createCurrent(
    run: SheetGenerationRun,
  ): Promise<SheetRunCreationResult> {
    const current = this.currentFor(run.sessionId);
    if (current !== null) {
      this.rows.set(current.runId, {
        ...current,
        isCurrent: false,
        status: "INVALIDATED",
      });
    }
    this.rows.set(run.runId, cloneRun(run));
    return { kind: "created_current", run: cloneRun(run) };
  }

  async getById(runId: string): Promise<SheetGenerationRun | null> {
    const row = this.rows.get(runId);
    return row === undefined ? null : cloneRun(row);
  }

  async getCurrentForSession(
    sessionId: string,
  ): Promise<SheetGenerationRun | null> {
    const current = this.currentFor(sessionId);
    return current === null ? null : cloneRun(current);
  }

  private async transition(
    runId: string,
    expected: readonly SheetGenerationRun["status"][],
    next: {
      status: SheetGenerationRun["status"];
      isCurrent: boolean;
      failureCode?: SheetRunFailureCode | null;
    },
    updatedAt: Date,
  ): Promise<RunTransitionResult> {
    const run = this.rows.get(runId);
    if (run === undefined) {
      return { kind: "not_found" };
    }
    if (!run.isCurrent) {
      return { kind: "not_current" };
    }
    if (!expected.includes(run.status)) {
      return { kind: "wrong_state" };
    }
    const nextRun = {
      ...run,
      ...next,
      failureCode:
        next.failureCode === undefined ? run.failureCode : next.failureCode,
      updatedAt,
    };
    this.rows.set(runId, nextRun);
    return { kind: "transitioned", run: cloneRun(nextRun) };
  }

  async markReady(
    runId: string,
    updatedAt: Date,
  ): Promise<RunTransitionResult> {
    return this.transition(
      runId,
      ["PENDING"],
      { status: "READY", isCurrent: true, failureCode: null },
      updatedAt,
    );
  }

  async markFailed(
    runId: string,
    failureCode: SheetRunFailureCode,
    updatedAt: Date,
  ): Promise<RunTransitionResult> {
    return this.transition(
      runId,
      ["PENDING"],
      { status: "FAILED", isCurrent: true, failureCode },
      updatedAt,
    );
  }

  async invalidateCurrent(
    runId: string,
    updatedAt: Date,
  ): Promise<RunTransitionResult> {
    return this.transition(
      runId,
      ["PENDING", "READY"],
      { status: "INVALIDATED", isCurrent: false },
      updatedAt,
    );
  }

  async expire(runId: string, updatedAt: Date): Promise<RunTransitionResult> {
    return this.transition(
      runId,
      ["PENDING", "READY"],
      { status: "EXPIRED", isCurrent: false },
      updatedAt,
    );
  }

  async findCleanupCandidates(
    now: Date,
    limit: number,
  ): Promise<readonly RunCleanupCandidate[]> {
    const candidates: RunCleanupCandidate[] = [];
    for (const run of this.rows.values()) {
      if (run.expiresAt.getTime() <= now.getTime()) {
        candidates.push({ sessionId: run.sessionId, runId: run.runId });
      }
      if (candidates.length >= limit) {
        break;
      }
    }
    return candidates;
  }
}
