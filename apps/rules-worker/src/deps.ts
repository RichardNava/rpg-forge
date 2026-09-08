import { webCrypto } from "@repo/rules-analysis-session";
import { systemClock } from "./infrastructure/clock.js";
import { createD1SessionRepository } from "./infrastructure/db/repository.js";
import { createD1RulebookRepository } from "./infrastructure/db/rulebook-repository.js";
import { createPdfJsPageExtractor } from "./infrastructure/pdfjs-extractor.js";
import { createRateLimitPort } from "./infrastructure/rate-limit.js";
import {
  createR2TemporaryRulebookStorage,
  RulebookStorageUnavailableError,
} from "./infrastructure/r2-rulebook-storage.js";
import { createRulebookResourceCleaner } from "./infrastructure/rulebook-cleaner.js";
import { createCloudflareRulebookWorkflowPort } from "./infrastructure/rulebook-workflow.js";
import { createTurnstileHumanVerification } from "./infrastructure/turnstile.js";
import { type Env } from "./env.js";
import { type AppDeps } from "./handler.js";

export function createAppDeps(env: Env): AppDeps {
  const clock = systemClock;
  const repository = createD1SessionRepository(env.DB, { clock });
  const rulebookRepository = createD1RulebookRepository(env.DB, { clock });
  const rulebookStorage =
    env.RULEBOOK_BUCKET === undefined
      ? undefined
      : createR2TemporaryRulebookStorage(env.RULEBOOK_BUCKET);
  const rulebookWorkflow =
    env.RULEBOOK_INGESTION_WORKFLOW === undefined
      ? undefined
      : createCloudflareRulebookWorkflowPort(env.RULEBOOK_INGESTION_WORKFLOW);

  return {
    crypto: webCrypto,
    clock,
    repository,
    cleaner: createRulebookResourceCleaner({
      repository: rulebookRepository,
      ...(rulebookStorage === undefined ? {} : { storage: rulebookStorage }),
      ...(rulebookWorkflow === undefined ? {} : { workflow: rulebookWorkflow }),
    }),
    humanVerifier: createTurnstileHumanVerification(env),
    rateLimiter: createRateLimitPort(env, clock),
    rulebookRepository,
    ...(rulebookStorage === undefined ? {} : { rulebookStorage }),
    ...(rulebookWorkflow === undefined ? {} : { rulebookWorkflow }),
  };
}

export function createRulebookProcessingDeps(env: Env) {
  if (env.RULEBOOK_BUCKET === undefined) {
    throw new RulebookStorageUnavailableError();
  }
  const clock = systemClock;
  return {
    clock,
    sessionRepository: createD1SessionRepository(env.DB, { clock }),
    repository: createD1RulebookRepository(env.DB, { clock }),
    storage: createR2TemporaryRulebookStorage(env.RULEBOOK_BUCKET),
    extractor: createPdfJsPageExtractor(),
  };
}
