import {
  DraftError,
  applyDraftMutationV2,
  draftError,
  finalizeDraftV2,
  rerollLockedDraftValuesV2,
  validateDraftV2,
  type CharacterSheetDraftV2,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
  type SheetDraftUndoRequestV2,
} from "@repo/character-sheet-draft";
import {
  AiDraftCreationRequestV1Schema,
  buildFinalGenerationRequestV1,
  compileAiProposalToDraftV2,
  deriveNpcAuthoringContext,
  getStyleProfile,
  resolveFinalValues,
  validateAiDraftProposal,
  validateNpcAuthoringPlan,
  type AiDraftCreationRequestV1,
  type AiDraftProposalV1,
  type FinalGenerationStartRequestV1,
  type FinalGenerationStartResponseV1,
  type FinalPresentationPlanV1,
  type NpcValueAssignment,
} from "@repo/character-sheet-generation";
import {
  validatePortraitImageBytes,
  type PortraitAssetRef,
} from "@repo/character-sheet-portraits";
import { renderStyledCharacterSheetPdf } from "@repo/character-sheet-pdf-renderer";
import type { SheetSession, SheetSessionView } from "../api/sheet-api-types";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";

export interface LocalSheetBackendV2Options {
  /** Optional seed for the session's deterministic snapshot clock. */
  clock?: () => Date;
}

/**
 * In-memory `SheetApiClientV2Port` used in development when no rules-worker is
 * available. It exercises the real V2 domain rules (the same validation,
 * mutation, reroll and finalize functions the live Worker V2 handlers call),
 * but keeps snapshots in the browser tab instead of R2/D1. Production wiring
 * replaces this with `SheetApiClientV2`; the store and UI are identical either
 * way.
 *
 * This backend is a V2 development/test double, not an R2/D1 simulator: there
 * is no claim/commit lifecycle here. Reroll and confirm compare the request
 * `expectedVersion` against the stored current version first, mirroring the
 * Worker precondition order.
 */
/**
 * Deterministic local NPC authoring fake (LOCAL/test only, never a
 * production fallback). Fills every eligible blank with a bounded
 * deterministic value through the real semantic validation, so local runs
 * exercise the genuine validation + merge path without AI quota.
 */
function fakeLocalAuthoredAssignments(
  draft: CharacterSheetDraftV2,
): readonly NpcValueAssignment[] {
  const context = deriveNpcAuthoringContext(draft);
  if (context === null) return [];
  const plan = {
    schemaVersion: "1",
    assignments: context.blanks.map((blank) => {
      switch (blank.type) {
        case "number":
          return { key: blank.key, value: blank.min ?? 0 };
        case "choice":
          return { key: blank.key, value: blank.options?.[0] ?? "local" };
        case "date":
          return { key: blank.key, value: "1400-01-01" };
        case "checkbox":
          return { key: blank.key, value: false };
        case "list":
          return { key: blank.key, value: [`Local ${blank.label}`] };
        default:
          return { key: blank.key, value: `Local ${blank.label}` };
      }
    }),
  };
  return validateNpcAuthoringPlan(plan, draft);
}

/**
 * Deterministic local AI-draft proposal (LOCAL/test only). A small fixed
 * shape carrying the user's prompt as the character name; the real compiler
 * owns keys, versions, and persistence fields.
 */
function fakeLocalAiProposal(request: AiDraftCreationRequestV1): AiDraftProposalV1 {
  const name = request.prompt.trim().slice(0, 256);
  return {
    schemaVersion: "1",
    characterName: name === "" ? null : name,
    sections: [{ id: "core", title: "Core", parentId: null }],
    fields: [
      { id: "character_name", label: "Character name", type: "text" },
      { id: "strength", label: "Strength", type: "number", min: 1, max: 10 },
      { id: "notes", label: "Notes", type: "textarea" },
    ],
    structure: [
      { kind: "field", id: "character_name", parentId: null },
      { kind: "section", id: "core", parentId: null },
      { kind: "field", id: "strength", parentId: "core" },
      { kind: "field", id: "notes", parentId: "core" },
    ],
  };
}

export function createLocalSheetBackendV2(
  options: LocalSheetBackendV2Options = {},
): SheetApiClientV2Port {
  const sessions = new Map<
    string,
    { sessionId: string; accessToken: string }
  >();
  const drafts = new Map<string, CharacterSheetDraftV2>();
  const draftHistory = new Map<string, CharacterSheetDraftV2[]>(); // history of drafts for undo
  const finalPdfs = new Map<string, Uint8Array>();
  const finalRuns = new Map<string, { draftId: string; draftVersion: number }>();
  const portraitAssets = new Map<
    string,
    { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg"; source: "upload" | "url" | "ai" }
  >();
  const draftHeads = new Map<
    string,
    { undoSourceVersion: number | null; undoConsumed: boolean }
  >();
  const keyOf = (sessionId: string, draftId: string) =>
    `${sessionId}:${draftId}`;
  const now = options.clock ?? (() => new Date());

  function requireSession(sessionId: string, accessToken: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined || session.accessToken !== accessToken) {
      throw new Error("Session not found.");
    }
  }

  function requireOwnedDraft(
    sessionId: string,
    draftId: string,
  ): CharacterSheetDraftV2 {
    const draft = drafts.get(keyOf(sessionId, draftId));
    if (draft === undefined || draft.sessionId !== sessionId) {
      throw new Error("Draft not found.");
    }
    return draft;
  }

  function getDraftHistory(key: string): CharacterSheetDraftV2[] {
    return draftHistory.get(key) ?? [];
  }

  function addToHistory(key: string, draft: CharacterSheetDraftV2): void {
    const history = getDraftHistory(key);
    // Keep only last 10 versions to avoid memory issues
    if (history.length >= 10) {
      history.shift();
    }
    history.push(draft);
    draftHistory.set(key, history);
  }

  return {
    async createSession(): Promise<SheetSession> {
      const session: SheetSession = {
        sessionId: crypto.randomUUID(),
        accessToken: crypto.randomUUID(),
        expiresAt: new Date(now().getTime() + 120 * 60 * 1000).toISOString(),
      };
      sessions.set(session.sessionId, {
        sessionId: session.sessionId,
        accessToken: session.accessToken,
      });
      return session;
    },

    async getSession(
      sessionId: string,
      accessToken: string,
    ): Promise<SheetSessionView> {
      requireSession(sessionId, accessToken);
      return {
        sessionId,
        status: "ACTIVE",
        expiresAt: new Date(now().getTime() + 120 * 60 * 1000).toISOString(),
      };
    },

    async createDraft(
      sessionId: string,
      accessToken: string,
      request: SheetDraftCreateRequestV2,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const draft = validateDraftV2(request);
      if (draft.sessionId !== sessionId) {
        throw new DraftError(
          "invalid_draft",
          "The draft session does not match the authorized session.",
        );
      }
      if (draft.version !== 1) {
        throw new DraftError(
          "invalid_draft",
          "A new draft must start at version 1.",
        );
      }
      if (draft.baseVersion !== 1) {
        throw new DraftError(
          "invalid_draft",
          "A new draft must start at base version 1.",
        );
      }
      const key = keyOf(sessionId, draft.draftId);
      if (drafts.has(key)) {
        throw new DraftError(
          "invalid_draft",
          "A draft with this id already exists for this session.",
        );
      }
      drafts.set(key, draft);
      draftHeads.set(key, { undoSourceVersion: null, undoConsumed: false });
      return draft;
    },

    async generateAiDraft(
      sessionId: string,
      accessToken: string,
      request: AiDraftCreationRequestV1,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const validated = AiDraftCreationRequestV1Schema.safeParse(request);
      if (!validated.success) {
        throw new DraftError(
          "invalid_draft",
          "The AI draft request must carry a mode and a non-empty prompt.",
        );
      }
      // Deterministic local fake (LOCAL/test only): a small fixed proposal
      // shaped by the prompt, compiled through the real proposal validation
      // and application-owned compiler. Never calls Workers AI.
      const proposal = fakeLocalAiProposal(validated.data);
      const draft = compileAiProposalToDraftV2({
        proposal: validateAiDraftProposal(proposal),
        sessionId,
        draftId: crypto.randomUUID(),
        mode: validated.data.mode,
      });
      const key = keyOf(sessionId, draft.draftId);
      drafts.set(key, draft);
      draftHeads.set(key, { undoSourceVersion: null, undoConsumed: false });
      return draft;
    },

    async getDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      return requireOwnedDraft(sessionId, draftId);
    },

    async mutateDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftMutationRequestV2,
    ): Promise<{
      draft: CharacterSheetDraftV2;
      undoAvailable: boolean;
      undoSourceVersion: number | null;
    }> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      const next = applyDraftMutationV2(
        current,
        request.mutation as any,
        request.expectedVersion,
      );
      const key = keyOf(sessionId, draftId);

      // Update undo metadata: real mutations set undo source to current version
      if (next.version !== current.version) {
        const head = draftHeads.get(key) ?? {
          undoSourceVersion: null,
          undoConsumed: false,
        };
        draftHeads.set(key, {
          undoSourceVersion: current.version,
          undoConsumed: false,
        });
        // Add current version to history for undo
        addToHistory(key, current);
      }

      drafts.set(key, next);
      const head = draftHeads.get(key) ?? {
        undoSourceVersion: null,
        undoConsumed: false,
      };
      return {
        draft: next,
        undoAvailable: head.undoSourceVersion !== null && !head.undoConsumed,
        undoSourceVersion: head.undoSourceVersion,
      };
    },

    async rerollDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftRerollRequestV2,
    ): Promise<SheetDraftRerollResponseV2> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      const result = rerollLockedDraftValuesV2(current, request.seed);
      drafts.set(keyOf(sessionId, draftId), result.draft);
      return result;
    },

    async confirmDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftConfirmRequestV2,
    ): Promise<CharacterSheetDraftV2> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      const confirmed = finalizeDraftV2(current);
      drafts.set(keyOf(sessionId, draftId), confirmed);
      return confirmed;
    },

    async undoDraft(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: SheetDraftUndoRequestV2,
    ): Promise<{
      draft: CharacterSheetDraftV2;
      undoAvailable: boolean;
      undoSourceVersion: number | null;
    }> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      const key = keyOf(sessionId, draftId);
      const head = draftHeads.get(key);
      if (!head || head.undoSourceVersion === null) {
        throw draftError("invalid_mutation", "No undo source version available.");
      }
      if (head.undoConsumed) {
        throw draftError("invalid_mutation", "The one-level Undo has already been consumed.");
      }

      // Get the undo source version from the head
      const undoSourceVersion = head.undoSourceVersion;

      // Get the history and find the draft at the undo source version
      const history = getDraftHistory(key);
      const undoSourceDraft = history.find(d => d.version === undoSourceVersion);
      if (!undoSourceDraft) {
        throw draftError("invalid_mutation", "The undo source snapshot could not be loaded.");
      }

      // Create the undone draft by restoring from the undo source
      const nextVersion = current.version + 1;
      const undoneDraft: CharacterSheetDraftV2 = {
        ...undoSourceDraft,
        draftId: current.draftId,
        sessionId: current.sessionId,
        baseVersion: current.baseVersion,
        version: current.version, // undo mutation will bump to V+1
        mode: current.mode,
        rulesContextId: current.rulesContextId,
        source: current.source,
        characterName: (undoSourceDraft.values["character_name"] as string) ?? null,
        confirmed: false,
      };

      // Apply the undo mutation which bumps version to current.version + 1
      const undoMutation = { op: "undo" } as const;
      const finalDraft = applyDraftMutationV2(undoneDraft, undoMutation as any, undoneDraft.version);

      // Update the head: mark undo as consumed, keep the same undo source version
      draftHeads.set(key, {
        undoSourceVersion: head.undoSourceVersion,
        undoConsumed: true,
      });

      drafts.set(key, finalDraft);
      return {
        draft: finalDraft,
        undoAvailable: false,
        undoSourceVersion: head.undoSourceVersion,
      };
    },

    async generateFinalSheet(
      sessionId: string,
      accessToken: string,
      draftId: string,
      request: FinalGenerationStartRequestV1,
    ): Promise<FinalGenerationStartResponseV1> {
      requireSession(sessionId, accessToken);
      const current = requireOwnedDraft(sessionId, draftId);
      if (request.expectedVersion !== current.version) {
        throw draftError(
          "version_conflict",
          `Expected draft version ${request.expectedVersion} but the current version is ${current.version}.`,
        );
      }
      // Provider-free local path: real resolver + real styled renderer +
      // deterministic fake presentation plan. Never calls Workers AI.
      const built = buildFinalGenerationRequestV1(current, {
        threat: request.options.threat ?? null,
        visualStyle: request.options.visualStyle,
        instructions: request.options.instructions ?? null,
        npcInstructions: request.options.npcInstructions ?? null,
        portrait: request.options.portrait,
        seed: request.seed,
      });
      if (built.options.visualStyle !== "medieval" && built.options.visualStyle !== "sci-fi") {
        throw new DraftError(
          "invalid_mutation",
          `Unsupported final presentation style: ${String(built.options.visualStyle)}.`,
        );
      }
      const draftSlots = current.slots ?? [];
      if (draftSlots.length === 0 && built.options.portrait.kind !== "none") {
        throw new Error("A portrait asset requires a Portrait Slot on the draft.");
      }
      let portraitImage: {
        slotKey: string;
        bytes: Uint8Array;
        mimeType: "image/png" | "image/jpeg";
      } | null = null;
      if (built.options.portrait.kind !== "none") {
        const slot = draftSlots[0];
        const row =
          slot === undefined
            ? undefined
            : portraitAssets.get(`${sessionId}:${built.options.portrait.assetId}`);
        if (slot === undefined || row === undefined) {
          throw new Error("The portrait asset is missing for this session.");
        }
        portraitImage = { slotKey: slot.key, bytes: row.bytes, mimeType: row.mimeType };
      }
      // Deterministic local authoring fake (LOCAL/test only, never a
      // production fallback): fills blanks with bounded deterministic values
      // through the real validation + merge path. No AI quota consumed.
      const localNpcInstructions = built.options.npcInstructions ?? null;
      const authored =
        localNpcInstructions === null
          ? null
          : fakeLocalAuthoredAssignments(current);
      const resolved = resolveFinalValues(current, {
        threat: built.options.threat ?? null,
        seed: built.seed,
        authoredAssignments: authored,
      });
      const plan: FinalPresentationPlanV1 = {
        schemaVersion: "1",
        style: built.options.visualStyle,
        variant: "standard",
        ornamentDensity: "light",
        contrast: "medium",
        sectionEmphasis: "standard",
        fieldEmphasis: "standard",
      };
      const { bytes } = await renderStyledCharacterSheetPdf({
        draft: current,
        resolvedValues: resolved,
        presentation: plan,
        profile: getStyleProfile(built.options.visualStyle),
        portrait: portraitImage,
      });
      const runId = crypto.randomUUID();
      finalPdfs.set(`${sessionId}:${runId}`, bytes);
      finalRuns.set(`${sessionId}:${runId}`, {
        draftId: current.draftId,
        draftVersion: current.version,
      });
      return {
        schemaVersion: "1",
        runId,
        status: "READY",
        draftId: current.draftId,
        draftVersion: current.version,
      };
    },

    async downloadFinalPdf(
      sessionId: string,
      accessToken: string,
      runId: string,
    ): Promise<Uint8Array> {
      requireSession(sessionId, accessToken);
      const bytes = finalPdfs.get(`${sessionId}:${runId}`);
      if (bytes === undefined) {
        throw new Error("Final PDF not found.");
      }
      return bytes;
    },

    async uploadPortrait(
      sessionId: string,
      accessToken: string,
      file: File,
    ): Promise<PortraitAssetRef> {
      requireSession(sessionId, accessToken);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const validated = validatePortraitImageBytes(bytes);
      if (!validated.valid || validated.mimeType === null) {
        throw new Error("The portrait image is not a valid PNG or JPEG.");
      }
      const assetId = crypto.randomUUID();
      portraitAssets.set(`${sessionId}:${assetId}`, {
        bytes,
        mimeType: validated.mimeType,
        source: "upload",
      });
      return {
        schemaVersion: "1",
        assetId,
        source: "upload",
        mimeType: validated.mimeType,
      };
    },

    async importPortraitUrl(
      sessionId: string,
      accessToken: string,
      url: string,
    ): Promise<PortraitAssetRef> {
      requireSession(sessionId, accessToken);
      void url;
      throw new Error("URL portrait import is unavailable in local mode.");
    },

    async generatePortrait(
      sessionId: string,
      accessToken: string,
      prompt: string,
    ): Promise<PortraitAssetRef> {
      requireSession(sessionId, accessToken);
      void prompt;
      throw new Error("AI portrait generation is unavailable in local mode.");
    },

    async downloadPortrait(
      sessionId: string,
      accessToken: string,
      assetId: string,
    ): Promise<{ bytes: Uint8Array; mimeType: string }> {
      requireSession(sessionId, accessToken);
      const row = portraitAssets.get(`${sessionId}:${assetId}`);
      if (row === undefined) {
        throw new Error("Portrait asset not found.");
      }
      return { bytes: row.bytes.slice(), mimeType: row.mimeType };
    },
  };
}
