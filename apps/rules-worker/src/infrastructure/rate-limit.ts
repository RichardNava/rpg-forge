import type {
  Clock,
  RateLimitPort,
  RateLimitResult,
} from "@repo/rules-analysis-session";
import type { Env } from "../env.js";

export interface InMemoryRateLimiterOptions {
  limit: number;
  windowMs: number;
  clock: Clock;
}

/**
 * Deterministic fixed-window in-memory limiter used for local development and
 * deterministic tests.
 */
export function createInMemoryRateLimiter(
  options: InMemoryRateLimiterOptions,
): RateLimitPort {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async consume(key: string): Promise<RateLimitResult> {
      const now = options.clock.now().getTime();
      const current = windows.get(key);
      if (current === undefined || now - current.start >= options.windowMs) {
        windows.set(key, { start: now, count: 1 });
        return { kind: "allowed" };
      }
      if (current.count < options.limit) {
        current.count += 1;
        return { kind: "allowed" };
      }
      return { kind: "denied" };
    },
  };
}

let inMemoryFallback: RateLimitPort | undefined;

const LOCAL_RATE_LIMIT = 20;
const LOCAL_RATE_WINDOW_MS = 60_000;
const LOCAL_DEV_MODE = "local";

/**
 * Fail-closed production rate limiting.
 *
 * The Cloudflare Rate Limiting binding (env.RATE_LIMITER) is the only rate
 * limit that runs in production. The in-memory limiter is reserved for an
 * explicit local-development switch: RATE_LIMIT_MODE === "local". Any other
 * value (including an absent setting) means production/default intent, and a
 * missing RATE_LIMITER binding is reported as "unavailable" so the worker
 * fails closed instead of silently falling-back or allowing unthrottled
 * traffic.
 */
export function createRateLimitPort(env: Env, clock: Clock): RateLimitPort {
  const binding = env.RATE_LIMITER;
  if (binding !== undefined) {
    return {
      async consume(key: string): Promise<RateLimitResult> {
        try {
          const outcome = await binding.limit({ key });
          return { kind: outcome.success ? "allowed" : "denied" };
        } catch {
          return { kind: "unavailable" };
        }
      },
    };
  }
  if (env.RATE_LIMIT_MODE === LOCAL_DEV_MODE) {
    inMemoryFallback ??= createInMemoryRateLimiter({
      limit: LOCAL_RATE_LIMIT,
      windowMs: LOCAL_RATE_WINDOW_MS,
      clock,
    });
    return inMemoryFallback;
  }
  return {
    async consume(): Promise<RateLimitResult> {
      return { kind: "unavailable" };
    },
  };
}
