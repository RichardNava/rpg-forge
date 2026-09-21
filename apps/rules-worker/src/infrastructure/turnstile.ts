import type {
  HumanVerificationPort,
  VerificationRequestContext,
  VerificationResult,
} from "@repo/rules-analysis-session";
import type { Env } from "../env.js";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LOCAL_TURNSTILE_MODE = "local";
const LOCAL_TURNSTILE_TOKEN = "local-turnstile-bypass";

interface SiteVerifyPayload {
  secret: string;
  response: string;
  remoteip?: string;
}

interface SiteVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

function isSiteVerifyResponse(value: unknown): value is SiteVerifyResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.success === "boolean";
}

/**
 * Cloudflare Turnstile server-side verification adapter. It intentionally
 * fails closed: if the secret binding is missing or the verification call
 * cannot be made, the result is "unavailable" and session creation is denied.
 */
export function createTurnstileHumanVerification(
  env: Pick<Env, "TURNSTILE_MODE" | "TURNSTILE_SECRET">,
): HumanVerificationPort {
  return {
    async verify(
      token: string,
      context: VerificationRequestContext,
    ): Promise<VerificationResult> {
      // Local-only opt-in: production has no bypass configuration and remains
      // fail-closed when its Turnstile secret is absent.
      if (
        env.TURNSTILE_MODE === LOCAL_TURNSTILE_MODE &&
        token === LOCAL_TURNSTILE_TOKEN
      ) {
        return { kind: "success" };
      }
      const secret = env.TURNSTILE_SECRET;
      if (secret === undefined || secret === "") {
        return { kind: "unavailable" };
      }
      const payload: SiteVerifyPayload = {
        secret,
        response: token,
      };
      if (context.clientIp !== undefined && context.clientIp !== "") {
        payload.remoteip = context.clientIp;
      }
      let response: Response;
      try {
        response = await fetch(TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (!response.ok) {
        return { kind: "unavailable" };
      }
      const body = await response.json().catch(() => null);
      if (!isSiteVerifyResponse(body)) {
        return { kind: "unavailable" };
      }
      return body.success ? { kind: "success" } : { kind: "failed" };
    },
  };
}
