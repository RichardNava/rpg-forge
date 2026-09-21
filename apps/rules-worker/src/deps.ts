import { webCrypto } from "@repo/rules-analysis-session";
import { systemClock } from "./infrastructure/clock.js";
import { AiProviderUnavailableError } from "./infrastructure/ai-errors.js";
import { createCloudflareAiEmbeddings } from "./infrastructure/ai-embeddings.js";
import { createCloudflareAiRuleAnalysis } from "./infrastructure/ai-analysis.js";
import { createD1SessionRepository } from "./infrastructure/db/repository.js";
import { createD1RulebookRepository } from "./infrastructure/db/rulebook-repository.js";
import { createD1RulesAnalysisRunRepository } from "./infrastructure/db/run-repository.js";
import { createD1SheetSessionRepository } from "./infrastructure/db/sheet-session-repository.js";
import { createD1DraftHeadRepository } from "./infrastructure/db/draft-head-repository.js";
import { createPdfJsPageExtractor } from "./infrastructure/pdfjs-extractor.js";
import { createRateLimitPort } from "./infrastructure/rate-limit.js";
import {
  createR2TemporaryRulebookStorage,
  RulebookStorageUnavailableError,
} from "./infrastructure/r2-rulebook-storage.js";
import { createR2ChunkSource } from "./infrastructure/r2-chunk-source.js";
import { createR2RulebookFileHash } from "./infrastructure/r2-rulebook-file-hash.js";
import { createR2RuleArtifacts } from "./infrastructure/r2-rule-artifacts.js";
import { createR2CharacterSheetDraftStore } from "./infrastructure/r2-character-sheet-drafts.js";
import { createR2CharacterSheetArtifactStore } from "./infrastructure/r2-character-sheet-artifacts.js";
import { createRulebookResourceCleaner } from "./infrastructure/rulebook-cleaner.js";
import { createCloudflareRulebookWorkflowPort } from "./infrastructure/rulebook-workflow.js";
import { createCloudflareRulesAnalysisWorkflowPort } from "./infrastructure/rules-analysis-workflow.js";
import { createTurnstileHumanVerification } from "./infrastructure/turnstile.js";
import { createCloudflareSheetVisualExtraction } from "./infrastructure/sheet-visual-extraction.js";
import {
  VectorIndexUnavailableError,
  createVectorizeIndex,
} from "./infrastructure/vectorize-index.js";
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
  const rulesAnalysisRunRepository = createD1RulesAnalysisRunRepository(
    env.DB,
    {
      clock,
    },
  );
  const rulesAnalysisArtifactStore =
    env.RULEBOOK_BUCKET === undefined
      ? undefined
      : createR2RuleArtifacts(env.RULEBOOK_BUCKET);
  const rulesAnalysisVectorIndex =
    env.VECTORIZE === undefined
      ? undefined
      : createVectorizeIndex(env.VECTORIZE);
  const rulesAnalysisWorkflow =
    env.RULES_ANALYSIS_WORKFLOW === undefined
      ? undefined
      : createCloudflareRulesAnalysisWorkflowPort(env.RULES_ANALYSIS_WORKFLOW);

  const sheetSessionRepository = createD1SheetSessionRepository(env.DB, {
    clock,
  });
  const sheetDraftHeadRepository = createD1DraftHeadRepository(env.DB);
  const sheetDraftStore =
    env.SHEET_ARTIFACTS === undefined
      ? undefined
      : createR2CharacterSheetDraftStore(env.SHEET_ARTIFACTS);
  const sheetArtifactStore =
    env.SHEET_ARTIFACTS === undefined
      ? undefined
      : createR2CharacterSheetArtifactStore(env.SHEET_ARTIFACTS);
  const sheetVisualExtraction =
    env.AI === undefined || env.SHEET_VISION_MODEL === undefined
      ? undefined
      : createCloudflareSheetVisualExtraction(env.AI, env.SHEET_VISION_MODEL, {
          debugRawResponse:
            env.RATE_LIMIT_MODE === "local" &&
            env.SHEET_VISION_DEBUG_RAW_RESPONSE === "true",
        });

  return {
    crypto: webCrypto,
    clock,
    repository,
    cleaner: createRulebookResourceCleaner({
      repository: rulebookRepository,
      ...(rulebookStorage === undefined ? {} : { storage: rulebookStorage }),
      ...(rulebookWorkflow === undefined ? {} : { workflow: rulebookWorkflow }),
      runRepository: rulesAnalysisRunRepository,
      ...(rulesAnalysisArtifactStore === undefined
        ? {}
        : { artifactStore: rulesAnalysisArtifactStore }),
      ...(rulesAnalysisVectorIndex === undefined
        ? {}
        : { vectorIndex: rulesAnalysisVectorIndex }),
    }),
    humanVerifier: createTurnstileHumanVerification(env),
    rateLimiter: createRateLimitPort(env, clock),
    rulebookRepository,
    rulesAnalysisRunRepository,
    ...(rulebookStorage === undefined ? {} : { rulebookStorage }),
    ...(rulebookWorkflow === undefined ? {} : { rulebookWorkflow }),
    ...(rulesAnalysisArtifactStore === undefined
      ? {}
      : { rulesAnalysisArtifactStore }),
    ...(rulesAnalysisVectorIndex === undefined
      ? {}
      : { rulesAnalysisVectorIndex }),
    ...(rulesAnalysisWorkflow === undefined ? {} : { rulesAnalysisWorkflow }),
    sheetSessionRepository,
    sheetDraftHeadRepository,
    ...(sheetDraftStore === undefined ? {} : { sheetDraftStore }),
    ...(sheetArtifactStore === undefined ? {} : { sheetArtifactStore }),
    ...(sheetVisualExtraction === undefined ? {} : { sheetVisualExtraction }),
    debugSheetDrafts: env.SHEET_DRAFT_DEBUG === "true",
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

/**
 * Processing deps for a rules analysis run. Construction fails closed when any
 * required runtime binding is missing; the analysis workflow catches this and
 * marks the run FAILED via D1 alone so it can never block begin forever.
 */
export function createRulesAnalysisRunDeps(env: Env) {
  if (env.RULEBOOK_BUCKET === undefined) {
    throw new RulebookStorageUnavailableError();
  }
  if (env.AI === undefined) {
    throw new AiProviderUnavailableError();
  }
  if (env.VECTORIZE === undefined) {
    throw new VectorIndexUnavailableError();
  }
  const clock = systemClock;
  return {
    clock,
    runRepository: createD1RulesAnalysisRunRepository(env.DB, { clock }),
    rulebookRepository: createD1RulebookRepository(env.DB, { clock }),
    chunkSource: createR2ChunkSource(env.RULEBOOK_BUCKET),
    fileHash: createR2RulebookFileHash(env.RULEBOOK_BUCKET),
    embeddings: createCloudflareAiEmbeddings(env.AI),
    vectorIndex: createVectorizeIndex(env.VECTORIZE),
    analysis: createCloudflareAiRuleAnalysis(env.AI),
    artifactStore: createR2RuleArtifacts(env.RULEBOOK_BUCKET),
  };
}
