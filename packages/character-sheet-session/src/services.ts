import {
  ACCESS_TOKEN_BYTE_LENGTH,
  type Clock,
  generateAccessToken,
  hashTokenSha256,
  type SessionCrypto,
  verifyTokenHash,
} from "@repo/rules-analysis-session";
import { isExpired, SHEET_SESSION_LIFETIME_MS } from "./sheet-session.js";
import type { SheetSessionRepositoryPort } from "./sheet-session-repository.js";

export interface CreateSheetSessionResult {
  sessionId: string;
  accessToken: string;
  expiresAt: Date;
}

export interface CreateSheetSessionDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SheetSessionRepositoryPort;
}

/**
 * Creates a temporary sheet session. The plaintext access token is returned
 * exactly once; persistence receives only the SHA-256 token hash.
 */
export async function createSheetSession(
  deps: CreateSheetSessionDeps,
): Promise<CreateSheetSessionResult> {
  const now = deps.clock.now();
  const sessionId = deps.crypto.uuid();
  const accessToken = generateAccessToken(
    ACCESS_TOKEN_BYTE_LENGTH,
    deps.crypto,
  );
  const tokenHash = await hashTokenSha256(accessToken, deps.crypto);
  const expiresAt = new Date(now.getTime() + SHEET_SESSION_LIFETIME_MS);
  await deps.repository.create({
    sessionId,
    tokenHash,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });
  return { sessionId, accessToken, expiresAt };
}

export type SheetAuthorizeResult =
  | { kind: "ok"; session: { sessionId: string } }
  | { kind: "not_found_or_unauthorized" }
  | { kind: "expired" };

export interface AuthorizeSheetSessionDeps {
  crypto: SessionCrypto;
  clock: Clock;
  repository: SheetSessionRepositoryPort;
}

/**
 * Authorizes a token without any HTTP knowledge. A valid token on an active,
 * unexpired session authorizes; a wrong token is indistinguishable from a
 * missing session; an expired session is rejected with its own outcome.
 */
export async function authorizeSheetSession(
  sessionId: string,
  accessToken: string,
  deps: AuthorizeSheetSessionDeps,
): Promise<SheetAuthorizeResult> {
  const session = await deps.repository.findById(sessionId);
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
  return { kind: "ok", session: { sessionId: session.sessionId } };
}
