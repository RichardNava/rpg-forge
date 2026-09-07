import type {
  AnalysisResourceCleanerPort,
  Clock,
  SessionCrypto,
  SessionRepositoryPort,
  RepositoryTransition,
  AnalysisSession,
} from "../index.js";
import { CLEANUP_RETRY_GRACE_MS } from "../session.js";

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
  set(ms: number): void {
    this.current = new Date(ms);
  }
}

export class FakeCrypto implements SessionCrypto {
  private sequence = 0;
  private static nextInstance = 0;
  readonly uuidPrefix: string;
  constructor() {
    FakeCrypto.nextInstance += 1;
    this.uuidPrefix = `fake-uuid-${FakeCrypto.nextInstance}`;
  }
  uuid(): string {
    this.sequence += 1;
    return `${this.uuidPrefix}-${this.sequence}`;
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
    let h3 = 0xdeadbeef;
    let h4 = 0x12345678;
    const prime = 0x01000193;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] ?? 0;
      h1 = Math.imul(h1 ^ b, prime) >>> 0;
      h2 = (Math.imul(h2, 31) + b) >>> 0;
      h3 = (Math.imul(h3, 17) ^ b) >>> 0;
      h4 = (h4 + Math.imul(b, 0x9e3779b1)) >>> 0;
    }
    const h5 = Math.imul(h1 ^ h2, 0x85ebca6b) >>> 0;
    const h6 = Math.imul(h3 ^ h4, 0xc2b2ae35) >>> 0;
    const h7 = (h1 ^ h3 ^ (bytes.length * 0x9e3779b9)) >>> 0;
    const h8 = (h2 ^ h4 ^ (bytes.length << 7)) >>> 0;
    return (
      h1.toString(16).padStart(8, "0") +
      h2.toString(16).padStart(8, "0") +
      h3.toString(16).padStart(8, "0") +
      h4.toString(16).padStart(8, "0") +
      h5.toString(16).padStart(8, "0") +
      h6.toString(16).padStart(8, "0") +
      h7.toString(16).padStart(8, "0") +
      h8.toString(16).padStart(8, "0")
    );
  }
}

export class InMemoryRepository implements SessionRepositoryPort {
  sessions = new Map<string, AnalysisSession>();
  createLog: string[] = [];
  deleteLog: string[] = [];
  transitionLog: string[] = [];

  async create(session: AnalysisSession): Promise<void> {
    this.createLog.push(session.analysisId);
    this.sessions.set(session.analysisId, cloneSession(session));
  }

  async findById(analysisId: string): Promise<AnalysisSession | null> {
    const session = this.sessions.get(analysisId);
    return session === undefined ? null : cloneSession(session);
  }

  async markDeletingIfActive(
    analysisId: string,
  ): Promise<RepositoryTransition> {
    const session = this.sessions.get(analysisId);
    if (session === undefined) {
      return "not_found";
    }
    const next = cloneSession(session);
    if (next.status === "ACTIVE") {
      next.status = "DELETING";
      this.sessions.set(analysisId, next);
      this.transitionLog.push(`transitioned:${analysisId}`);
      return "transitioned";
    }
    this.transitionLog.push(`already_deleting:${analysisId}`);
    return "already_deleting";
  }

  async findCleanupCandidates(
    now: Date,
    limit: number,
  ): Promise<AnalysisSession[]> {
    const candidates: AnalysisSession[] = [];
    for (const session of this.sessions.values()) {
      const expiredActive =
        session.status === "ACTIVE" &&
        session.expiresAt.getTime() <= now.getTime();
      const staleDeleting =
        session.status === "DELETING" &&
        session.updatedAt.getTime() <= now.getTime() - CLEANUP_RETRY_GRACE_MS;
      if (expiredActive || staleDeleting) {
        candidates.push(cloneSession(session));
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

export class RecordingCleaner implements AnalysisResourceCleanerPort {
  cleaned: string[] = [];
  failOn = new Set<string>();
  async cleanup(analysisId: string): Promise<void> {
    if (this.failOn.has(analysisId)) {
      throw new Error(`cleanup failure for ${analysisId}`);
    }
    this.cleaned.push(analysisId);
  }
}

function cloneSession(session: AnalysisSession): AnalysisSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt.getTime()),
    updatedAt: new Date(session.updatedAt.getTime()),
    expiresAt: new Date(session.expiresAt.getTime()),
  };
}
