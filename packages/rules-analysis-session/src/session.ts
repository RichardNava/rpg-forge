export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export const ACCESS_TOKEN_BYTE_LENGTH = 32;

export const MAX_CLEANUP_BATCH_SIZE = 100;

export const CLEANUP_RETRY_GRACE_MS = 60 * 60 * 1000;

export const SESSION_STATUSES = ["ACTIVE", "DELETING"] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface AnalysisSession {
  analysisId: string;
  tokenHash: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface PublicAnalysisSession {
  analysisId: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
}

export function toPublicSession(
  session: AnalysisSession,
): PublicAnalysisSession {
  return {
    analysisId: session.analysisId,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function isExpired(session: AnalysisSession, now: Date): boolean {
  return now.getTime() >= session.expiresAt.getTime();
}
