import type { AnalysisResourceCleanerPort } from "./cleaner.js";
import type { Clock } from "./clock.js";
import {
  generateAccessToken,
  hashTokenSha256,
  type SessionCrypto,
  verifyTokenHash,
} from "./crypto.js";
import type { SessionRepositoryPort } from "./repository.js";
import {
  ACCESS_TOKEN_BYTE_LENGTH,
  isExpired,
  type AnalysisSession,
  SESSION_LIFETIME_MS,
} from "./session.js";

export interface CreateSessionResult {
  analysisId: string;
  accessToken: string;
  expiresAt: Date;
}

export interface CreateSessionDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SessionRepositoryPort;
}

export async function createAnalysisSession(
  deps: CreateSessionDeps,
): Promise<CreateSessionResult> {
  const now = deps.clock.now();
  const analysisId = deps.crypto.uuid();
  const accessToken = generateAccessToken(
    ACCESS_TOKEN_BYTE_LENGTH,
    deps.crypto,
  );
  const tokenHash = await hashTokenSha256(accessToken, deps.crypto);
  const createdAt = now;
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await deps.repository.create({
    analysisId,
    tokenHash,
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  });
  return { analysisId, accessToken, expiresAt };
}

export type AuthorizeResult =
  | { kind: "ok"; session: AnalysisSession }
  | { kind: "not_found_or_unauthorized" }
  | { kind: "expired" };

export interface AuthorizeDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SessionRepositoryPort;
}

export async function authorizeSession(
  analysisId: string,
  accessToken: string,
  deps: AuthorizeDeps,
): Promise<AuthorizeResult> {
  const session = await deps.repository.findById(analysisId);
  if (session === null) {
    return { kind: "not_found_or_unauthorized" };
  }
  const tokenMatches = await verifyTokenHash(
    accessToken,
    session.tokenHash,
    deps.crypto,
  );
  if (!tokenMatches) {
    return { kind: "not_found_or_unauthorized" };
  }
  if (isExpired(session, deps.clock.now())) {
    return { kind: "expired" };
  }
  return { kind: "ok", session };
}

export type DeleteSessionResult =
  | { kind: "deleted" }
  | { kind: "not_found_or_unauthorized" }
  | { kind: "expired" };

export interface DeleteSessionDeps extends AuthorizeDeps {
  cleaner: AnalysisResourceCleanerPort;
}

export async function deleteSession(
  analysisId: string,
  accessToken: string,
  deps: DeleteSessionDeps,
): Promise<DeleteSessionResult> {
  const authorization = await authorizeSession(analysisId, accessToken, deps);
  if (authorization.kind !== "ok") {
    return { kind: authorization.kind };
  }
  const transition = await deps.repository.markDeletingIfActive(analysisId);
  if (transition === "not_found") {
    return { kind: "not_found_or_unauthorized" };
  }
  if (transition === "transitioned" || transition === "already_deleting") {
    await deps.cleaner.cleanup(analysisId);
  }
  await deps.repository.delete(analysisId);
  return { kind: "deleted" };
}

export interface CleanupResult {
  processed: number;
  deleted: number;
  failed: string[];
}

export interface RunExpiryCleanupDeps {
  now: Date;
  repository: SessionRepositoryPort;
  cleaner: AnalysisResourceCleanerPort;
  limit?: number;
}

export async function runExpiryCleanup(
  deps: RunExpiryCleanupDeps,
): Promise<CleanupResult> {
  const limit = deps.limit ?? 100;
  const candidates = await deps.repository.findCleanupCandidates(
    deps.now,
    limit,
  );
  let deleted = 0;
  const failed: string[] = [];
  for (const candidate of candidates) {
    const transition = await deps.repository.markDeletingIfActive(
      candidate.analysisId,
    );
    if (transition === "not_found") {
      continue;
    }
    try {
      await deps.cleaner.cleanup(candidate.analysisId);
      await deps.repository.delete(candidate.analysisId);
      deleted += 1;
    } catch {
      failed.push(candidate.analysisId);
    }
  }
  return { processed: candidates.length, deleted, failed };
}
