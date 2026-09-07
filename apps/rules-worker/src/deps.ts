import { webCrypto } from "@repo/rules-analysis-session";
import { systemClock } from "./infrastructure/clock.js";
import { createNoOpResourceCleaner } from "./infrastructure/cleaner.js";
import { createD1SessionRepository } from "./infrastructure/db/repository.js";
import { createRateLimitPort } from "./infrastructure/rate-limit.js";
import { createTurnstileHumanVerification } from "./infrastructure/turnstile.js";
import { type Env } from "./env.js";
import { type AppDeps } from "./handler.js";

export function createAppDeps(env: Env): AppDeps {
  const clock = systemClock;
  return {
    crypto: webCrypto,
    clock,
    repository: createD1SessionRepository(env.DB, { clock }),
    cleaner: createNoOpResourceCleaner(),
    humanVerifier: createTurnstileHumanVerification(env),
    rateLimiter: createRateLimitPort(env, clock),
  };
}
