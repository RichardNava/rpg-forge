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
