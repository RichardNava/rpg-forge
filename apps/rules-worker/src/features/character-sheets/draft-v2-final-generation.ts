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
 *   -> optional NpcValueAuthoringPort (NPC + npcInstructions only)
 *   -> resolve final values (explicit > AI > threat fallback; Draft intact)
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
  deriveNpcAuthoringContext,
  FinalPresentationPlanV1Schema,
  FinalPresentationStyleV1Schema,
  resolveFinalValues,
  validateNpcAuthoringPlan,
  validatePresentationPlanForStyle,
  type FinalGenerationStartRequestV1,
  type FinalPresentationPlanV1,
  type FinalPresentationPort,
  type NpcValueAssignment,
  type NpcValueAuthoringPort,
} from "@repo/character-sheet-generation";
import type { CharacterSheetArtifactStore } from "@repo/character-sheet-artifacts";
import {
  deriveRunExpiry,
  type DraftHeadIdentity,
  type SheetGenerationRun,
  type SheetRunRepositoryPort,
  type SheetSessionRepositoryPort,
} from "@repo/character-sheet-session";
import {
  validatePortraitImageBytes,
  type CharacterSheetPortraitAssetStore,
} from "@repo/character-sheet-portraits";
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
  readonly portraits?: CharacterSheetPortraitAssetStore;
  readonly authoring?: NpcValueAuthoringPort;
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
  | "pc_npc_instructions"
  | "unsupported_style"
  | "invalid_options"
  | "portrait_without_slot"
  | "portrait_asset_invalid";

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
      npcInstructions: request.options.npcInstructions ?? null,
      portrait: request.options.portrait,
      seed: request.seed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The final-generation options are invalid.";
    if (message.includes("NPC authoring instructions")) {
      return { kind: "invalid", code: "pc_npc_instructions", message };
    }
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

  // 5b. Portrait Slot/config coherence (14.13). The slot is spatial Draft
  // authority; the image is temporary content. No slot + asset config is
  // rejected; a slot with `none` stays valid (portrait is optional).
  const draftSlots = draft.slots ?? [];
  const portraitConfig = built.options.portrait;
  if (draftSlots.length === 0 && portraitConfig.kind !== "none") {
    return {
      kind: "invalid",
      code: "portrait_without_slot",
      message: "A portrait asset requires a Portrait Slot on the draft.",
    };
  }
  if (portraitConfig.kind !== "none" && deps.portraits === undefined) {
    return {
      kind: "unavailable",
      message: "Portrait asset storage is unavailable.",
    };
  }

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

  // 6b. Optional NPC instruction-driven authoring (14.14). Null
  // instructions preserve 14.12 behavior: no authoring-model call, explicit
  // values preserved, deterministic threat fallback only. A provided
  // instruction that cannot be honored fails the run — the instructions are
  // never silently ignored in favor of threat.
  const npcInstructions = built.options.npcInstructions ?? null;
  let authored: readonly NpcValueAssignment[] | null = null;
  if (draft.mode === "npc" && npcInstructions !== null) {
    if (deps.authoring === undefined) {
      return fail("INTERNAL_ERROR", {
        kind: "unavailable",
        message: "NPC value authoring is unavailable.",
      });
    }
    const context = deriveNpcAuthoringContext(draft);
    if (context !== null && context.blanks.length > 0) {
      let plan: unknown;
      try {
        plan = await deps.authoring.generateAssignments({
          blanks: context.blanks,
          explicit: context.explicit,
          npcInstructions,
          threat: built.options.threat!,
          seed: built.seed,
        });
      } catch {
        return fail("GENERATION_FAILED", {
          kind: "unavailable",
          message: "NPC value authoring is unavailable.",
        });
      }
      try {
        authored = validateNpcAuthoringPlan(plan, draft);
      } catch (error) {
        return fail("GENERATION_FAILED", {
          kind: "failed",
          message:
            error instanceof Error
              ? error.message
              : "The NPC authoring plan was invalid.",
        });
      }
    }
  }

  // 7. Resolve final values (Draft never mutated). Priority: explicit user
  // values > validated AI assignments > threat/default deterministic fallback.
  let resolved: ReturnType<typeof resolveFinalValues>;
  try {
    resolved = resolveFinalValues(draft, {
      threat: built.options.threat ?? null,
      seed: built.seed,
      authoredAssignments: authored,
    });
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

  // 9b. Resolve the portrait image (14.13). The assetId is revalidated:
  // the asset must exist, belong to this session, match the configured
  // source kind, and carry valid bytes. The assetId alone is never trusted.
  let portraitImage: { slotKey: string; bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" } | null = null;
  if (portraitConfig.kind !== "none") {
    const slot = draftSlots[0];
    if (slot === undefined) {
      return fail("GENERATION_FAILED", {
        kind: "failed",
        message: "A portrait asset requires a Portrait Slot on the draft.",
      });
    }
    let record;
    try {
      record = await deps.portraits!.getAsset({
        sessionId: request.identity.sessionId,
        assetId: portraitConfig.assetId,
      });
    } catch {
      return fail("INTERNAL_ERROR", {
        kind: "failed",
        message: "Portrait asset storage is unavailable.",
      });
    }
    if (record === null || record.metadata.source !== portraitConfig.kind) {
      return fail("GENERATION_FAILED", {
        kind: "failed",
        message: "The portrait asset is missing or does not match its configured source.",
      });
    }
    const imageCheck = validatePortraitImageBytes(record.imageBytes);
    if (!imageCheck.valid || imageCheck.mimeType === null) {
      return fail("GENERATION_FAILED", {
        kind: "failed",
        message: "The stored portrait image is invalid.",
      });
    }
    portraitImage = {
      slotKey: slot.key,
      bytes: record.imageBytes,
      mimeType: imageCheck.mimeType,
    };
  }

  // 10. Draft-native styled PDF render.
  let pdfBytes: Uint8Array;
  try {
    const rendered = await renderStyledCharacterSheetPdf({
      draft,
      resolvedValues: resolved,
      presentation: plan,
      profile: getStyleProfile(style),
      portrait: portraitImage,
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
