/**
 * V2 final-generation orchestration for the live generate route (14.12).
 *
 * Synchronous No-Workflow orchestration:
 *
 * ```text
 * authoritative confirmed Draft load (expectedVersion barrier)
 *   -> build FinalGenerationRequestV1 server-side
 *   -> validate style is medieval | sci-fi
 *   -> create PENDING SheetGenerationRun (repost-as-reroll current)
 *   -> resolve final values (deterministic, Draft never mutated)
 *   -> invoke FinalPresentationPort (bounded AI plan)
 *   -> validate FinalPresentationPlanV1
 *   -> render Draft-native styled PDF
 *   -> persist final PDF in R2 (putPdfBytes, no manufactured spec)
 *   -> mark run READY
 *   -> return READY run descriptor
 * ```
 *
 * Failure at any post-create step marks the PENDING run FAILED, removes
 * partial run artifacts best-effort, and never exposes a partial PDF.
 *
 * Layering:
 *
 * HTTP transport parsing          -> FinalGenerationStartRequestV1Schema
 * HTTP egress serialization       -> FinalGenerationStartResponseV1Schema
 * THIS MODULE                     = V2 final-generation orchestration
 *     +--> openDraftV2Mutation       (4E3B1 runtime kernel)
 *     +--> buildFinalGenerationRequestV1 (generation package)
 *     +--> resolveFinalValues        (generation package)
 *     +--> FinalPresentationPort     (injected AI adapter or test fake)
 *     +--> renderStyledCharacterSheetPdf (pdf-renderer package)
 *     +--> SheetRunRepositoryPort    (D1 run lifecycle)
 *     +--> CharacterSheetArtifactStore.putPdfBytes (R2 final PDF)
 *     v
 * Live HTTP handler               (character-sheet-handler.ts)
 */
import {
  buildFinalGenerationRequestV1,
  createStructuralSummary,
  FinalPresentationPlanV1Schema,
  FinalPresentationStyleV1Schema,
  resolveFinalValues,
  validatePresentationPlanForStyle,
  type FinalGenerationStartRequestV1,
  type FinalPresentationPlanV1,
  type FinalPresentationPort,
} from "@repo/character-sheet-generation";
import type { CharacterSheetArtifactStore } from "@repo/character-sheet-artifacts";
import {
  deriveRunExpiry,
  type DraftHeadIdentity,
  type SheetGenerationRun,
  type SheetRunRepositoryPort,
  type SheetSessionRepositoryPort,
} from "@repo/character-sheet-session";
import type { Clock, SessionCrypto } from "@repo/rules-analysis-session";
import { renderStyledCharacterSheetPdf } from "@repo/character-sheet-pdf-renderer";
import { getStyleProfile } from "@repo/character-sheet-generation";
import { openDraftV2Mutation, type DraftV2Runtime } from "./draft-v2-runtime.js";

export interface FinalGenerationDeps {
  readonly runtime: DraftV2Runtime;
  readonly runs: SheetRunRepositoryPort;
  readonly artifacts: CharacterSheetArtifactStore;
  readonly sessions: SheetSessionRepositoryPort;
  readonly presentation?: FinalPresentationPort;
  readonly clock: Clock;
  readonly crypto: SessionCrypto;
}

export type FinalGenerationOutcome =
  | { kind: "ok"; run: SheetGenerationRun; plan: FinalPresentationPlanV1 }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "invalid"; code: FinalGenerationInvalidCode; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string };

export type FinalGenerationInvalidCode =
  | "unconfirmed"
  | "pc_threat"
  | "npc_threat_missing"
  | "unsupported_style"
  | "invalid_options";

export interface FinalGenerationRequest {
  readonly identity: DraftHeadIdentity;
  readonly expectedVersion: number;
  readonly options: FinalGenerationStartRequestV1["options"];
  readonly seed: string;
}

export async function generateFinalCharacterSheet(
  deps: FinalGenerationDeps,
  request: FinalGenerationRequest,
): Promise<FinalGenerationOutcome> {
  // 1-2. Authoritative Draft load with the exact-version barrier.
  const state = await openDraftV2Mutation(deps.runtime, request.identity, request.expectedVersion);
  if (state === null || state.draft === null) {
    return { kind: "not_found" };
  }
  const draft = state.draft;

  // 3. Confirmed-only gate (before any run is created).
  if (!draft.confirmed) {
    return { kind: "invalid", code: "unconfirmed", message: "Only a confirmed draft can be finally generated." };
  }

  // 4. Build the canonical request server-side from the authoritative Draft.
  let built: ReturnType<typeof buildFinalGenerationRequestV1>;
  try {
    built = buildFinalGenerationRequestV1(draft, {
      threat: request.options.threat ?? null,
      visualStyle: request.options.visualStyle,
      instructions: request.options.instructions ?? null,
      portrait: request.options.portrait,
      seed: request.seed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The final-generation options are invalid.";
    if (message.includes("PC draft")) {
      return { kind: "invalid", code: "pc_threat", message };
    }
    if (message.includes("NPC draft")) {
      return { kind: "invalid", code: "npc_threat_missing", message };
    }
    return { kind: "invalid", code: "invalid_options", message };
  }

  // 5. 14.12 supports exactly medieval + sci-fi.
  const styleCheck = FinalPresentationStyleV1Schema.safeParse(built.options.visualStyle);
  if (!styleCheck.success) {
    return {
      kind: "invalid",
      code: "unsupported_style",
      message: `Unsupported final presentation style: ${String(built.options.visualStyle)}.`,
    };
  }
  const style = styleCheck.data;

  // 6. Create the PENDING run (repost-as-reroll current). Expiry borrows the session.
  const session = await deps.sessions.findById(request.identity.sessionId);
  if (session === null) {
    return { kind: "not_found" };
  }
  const now = deps.clock.now();
  const run: SheetGenerationRun = {
    runId: deps.crypto.uuid(),
    sessionId: request.identity.sessionId,
    analysisId: null,
    rulesAnalysisRunId: null,
    ingestionId: null,
    draftId: draft.draftId,
    draftVersion: draft.version,
    mode: draft.mode,
    status: "PENDING",
    failureCode: null,
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
    expiresAt: deriveRunExpiry(session),
  };
  const created = await deps.runs.createCurrent(run);
  if (created.kind !== "created_current") {
    return { kind: "conflict" };
  }

  const fail = async (
    failureCode: "GENERATION_FAILED" | "INTERNAL_ERROR",
    outcome: Extract<FinalGenerationOutcome, { kind: "unavailable" } | { kind: "failed" }>,
  ): Promise<Extract<FinalGenerationOutcome, { kind: "unavailable" } | { kind: "failed" }>> => {
    await deps.runs.markFailed(run.runId, failureCode, deps.clock.now());
    try {
      await deps.artifacts.deleteRunArtifacts({ sessionId: run.sessionId, runId: run.runId });
    } catch {
      // Best-effort compensation; the FAILED run state is authoritative.
    }
    return outcome;
  };

  // 7. Resolve final values (Draft never mutated).
  let resolved: ReturnType<typeof resolveFinalValues>;
  try {
    resolved = resolveFinalValues(draft, { threat: built.options.threat ?? null, seed: built.seed });
  } catch (error) {
    return fail("GENERATION_FAILED", {
      kind: "failed",
      message: error instanceof Error ? error.message : "Final value resolution failed.",
    });
  }

  // 8. Provider must exist; otherwise fail closed (no fake production fallback).
  if (deps.presentation === undefined) {
    return fail("INTERNAL_ERROR", {
      kind: "unavailable",
      message: "Final presentation generation is unavailable.",
    });
  }

  // 9. Bounded AI presentation plan.
  let plan: FinalPresentationPlanV1;
  try {
    const summary = createStructuralSummary(draft);
    plan = await deps.presentation.generatePlan(style, summary, built.options.instructions ?? null);
  } catch {
    return fail("GENERATION_FAILED", {
      kind: "unavailable",
      message: "Final presentation generation is unavailable.",
    });
  }
  const planParsed = FinalPresentationPlanV1Schema.safeParse(plan);
  if (!planParsed.success || planParsed.data.style !== style) {
    return fail("GENERATION_FAILED", {
      kind: "failed",
      message: "The presentation plan was invalid.",
    });
  }
  try {
    validatePresentationPlanForStyle(planParsed.data, style);
  } catch (error) {
    return fail("GENERATION_FAILED", {
      kind: "failed",
      message: error instanceof Error ? error.message : "The presentation plan was invalid.",
    });
  }
  plan = planParsed.data;

  // 10. Draft-native styled PDF render.
  let pdfBytes: Uint8Array;
  try {
    const rendered = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: plan,
      profile: getStyleProfile(style),
    });
    pdfBytes = rendered.bytes;
  } catch (error) {
    return fail("GENERATION_FAILED", {
      kind: "failed",
      message: error instanceof Error ? error.message : "Final styled rendering failed.",
    });
  }

  // 11. Persist the final PDF without manufacturing a spec.
  try {
    await deps.artifacts.putPdfBytes({ sessionId: run.sessionId, runId: run.runId, pdfBytes });
  } catch {
    return fail("INTERNAL_ERROR", {
      kind: "failed",
      message: "Final artifact storage is unavailable.",
    });
  }

  // 12. Mark READY.
  const ready = await deps.runs.markReady(run.runId, deps.clock.now());
  if (ready.kind !== "transitioned") {
    try {
      await deps.artifacts.deleteRunArtifacts({ sessionId: run.sessionId, runId: run.runId });
    } catch {
      // Best-effort.
    }
    return { kind: "failed", message: "The final run could not be completed." };
  }

  return { kind: "ok", run: ready.run, plan };
}
