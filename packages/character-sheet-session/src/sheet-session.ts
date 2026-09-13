import { CLEANUP_RETRY_GRACE_MS } from "@repo/rules-analysis-session";

/**
 * Temporary character-sheet session lifetime. Exactly 120 minutes; it does NOT
 * reuse the 12-hour `SESSION_LIFETIME_MS` of the rulebook-analysis pipeline.
 */
export const SHEET_SESSION_LIFETIME_MS = 120 * 60 * 1000;

/**
 * Retry grace for DELETING sessions whose cleanup previously failed, identical
 * to the rules-analysis cleanup convention so both pipelines share one
 * retry/cleanup cadence.
 */
export const SHEET_CLEANUP_RETRY_GRACE_MS = CLEANUP_RETRY_GRACE_MS;

export const SHEET_SESSION_STATUSES = ["ACTIVE", "DELETING"] as const;

export type SheetSessionStatus = (typeof SHEET_SESSION_STATUSES)[number];

/**
 * Operational record for a temporary character-sheet session. It never stores
 * the plaintext access token: only the SHA-256 token hash is persisted. No
 * account ownership exists: sessions are anonymous, self-contained and expire.
 */
export interface SheetSession {
  sessionId: string;
  tokenHash: string;
  status: SheetSessionStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export function isExpired(session: SheetSession, now: Date): boolean {
  return now.getTime() >= session.expiresAt.getTime();
}

/**
 * A generation run borrows its lifetime from the owning session: expiry is the
 * session `expiresAt`, never an independent window measured from run creation.
 * A late run created near session expiry therefore only gets the remaining
 * session lifetime.
 */
export function deriveRunExpiry(session: SheetSession): Date {
  return session.expiresAt;
}
