import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterSheetDraftV2,
  DraftLayoutNodeV1,
  DraftMutationV2,
  DraftValue,
} from "@repo/character-sheet-draft";
import type { DraftAddFieldV2Input } from "./AddFieldDialog";
import { SheetApiClientV2 } from "../api/sheet-api-client-v2";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";
import { createLocalSheetBackendV2 } from "../lib/local-sheet-backend-v2";
import { resolveSheetBackendMode } from "../lib/sheet-backend-mode";
import {
  createBlankDraftV2,
  createExampleDraftV2,
} from "../lib/dev-fixture-v2";
import { createLocalSheetDocumentExtractionServiceV2 } from "../extraction/local-extraction-service-v2";
import { createRemoteSheetDocumentExtractionServiceV2 } from "../extraction/remote-extraction-service-v2";
import { downloadConfirmedDraftPdfV2 } from "../export/export-confirmed-draft-pdf-v2";
import type {
  SheetDocumentExtractionServiceV2,
  SheetDocumentFileDescriptor,
} from "../extraction/extraction-service-v2";
import { createSheetStoreV2 } from "../state/sheet-store-v2";
import type { SheetStoreV2 } from "../state/sheet-store-v2-types";
import { useSheetStoreV2 } from "../hooks/use-sheet-store-v2";
import { CreationModeSelector } from "./CreationModeSelector";
import { WorkshopToolbar } from "./WorkshopToolbar";
import { SheetCanvasV2 } from "./canvas/SheetCanvasV2";
import { CanvasInspectorV2 } from "./canvas/CanvasInspectorV2";
import type { CanvasSelection } from "./canvas/canvas-types";
import { SheetPreviewV2 } from "./SheetPreviewV2";
import { AddFieldDialog } from "./AddFieldDialog";
import {
  AddSectionDialogV2,
  type AddSectionV2Result,
} from "./AddSectionDialogV2";
import { ConfirmDialog } from "./ConfirmDialog";
import { DestructiveConfirmDialog } from "./DestructiveConfirmDialog";
import { UploadSheetDialog } from "./UploadSheetDialog";
import { GenerateAiDraftDialog } from "./GenerateAiDraftDialog";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";
import type { WorkshopIdentityPatch } from "./WorkshopIdentitySelector";
import { WorkshopPortraitSelector } from "./WorkshopPortraitSelector";
import type {
  ThreatLevelPreference,
  VisualStyleKey,
} from "../state/sheet-workshop-types";
import {
  THREAT_LEVEL_EXPLANATION,
  THREAT_LEVEL_LABEL,
  THREAT_LEVEL_OPTIONS,
} from "../lib/workshop-preferences";

/**
 * Narrow session-token boundary for the V2 workshop. Local mode may resolve
 * the isolated-development bypass; remote mode MUST resolve a real Turnstile
 * token through the injected provider and fail closed without one. The
 * hardcoded `"local-turnstile-bypass"` string must never reach this workshop
 * in remote mode.
 */
export type SheetV2SessionTokenProvider = () => Promise<string>;

export interface CharacterWorkshopV2Props {
  sessionTokenProvider?: SheetV2SessionTokenProvider;
}

const BACKEND_MODE = resolveSheetBackendMode();
const LOCAL_TURNSTILE_BYPASS = "local-turnstile-bypass";

/**
 * Resolves the session token for the V2 workshop. Local mode may use the
 * isolated-development bypass; remote mode requires a real provider token
 * and fails closed otherwise — the bypass string itself is rejected.
 */
export async function resolveV2SessionToken(
  mode: string,
  provider: SheetV2SessionTokenProvider | undefined,
): Promise<string> {
  if (mode !== "remote") {
    return LOCAL_TURNSTILE_BYPASS;
  }
  if (provider === undefined) {
    throw new Error(
      "Human verification is required before starting a session.",
    );
  }
  const token = await provider();
  if (token === "" || token === LOCAL_TURNSTILE_BYPASS) {
    throw new Error(
      "Human verification is required before starting a session.",
    );
  }
  return token;
}

function createWorkshopBackendV2(): SheetApiClientV2Port {
  if (BACKEND_MODE === "remote") {
    return new SheetApiClientV2();
  }
  return createLocalSheetBackendV2();
}

/**
 * Production always uses the protected Worker endpoint. `local` is retained
 * only for explicit isolated-development tests and never simulates OCR.
 */
const SHEET_EXTRACTION_V2: SheetDocumentExtractionServiceV2 =
  BACKEND_MODE === "remote"
    ? createRemoteSheetDocumentExtractionServiceV2()
    : createLocalSheetDocumentExtractionServiceV2();

const LANDING_CHOICES = [
  {
    id: "upload",
    title: "Upload existing sheet",
    description:
      "Extract fields automatically from a PDF, PNG or JPG document.",
    cta: "Choose a file",
  },
  {
    id: "manual",
    title: "Create manually",
    description: "Build a character sheet from scratch.",
    cta: "Open the workshop",
  },
  {
    id: "generate-ai",
    title: "Generate Character with AI",
    description:
      "Describe a character; AI drafts an editable starting sheet you fully control.",
    cta: "Describe a character",
  },
];

type WorkshopScreen = "landing" | "editing" | "exported";
type WorkshopModal =
  | "none"
  | "add-field"
  | "add-section"
  | "confirm"
  | "upload"
  | "generate-ai"
  | "delete-field"
  | "delete-section";

export function CharacterWorkshopV2(props: CharacterWorkshopV2Props = {}) {
  const [store] = useState<SheetStoreV2>(() =>
    createSheetStoreV2({ api: createWorkshopBackendV2() }),
  );
  const state = useSheetStoreV2(store);
  const [screen, setScreen] = useState<WorkshopScreen>("landing");
  const [modal, setModal] = useState<WorkshopModal>("none");
  const [pending, setPending] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "field"; key: string } | { kind: "section"; key: string } | null
  >(null);
  const [finalStyle, setFinalStyle] = useState<"medieval" | "sci-fi">("medieval");
  const [finalInstructions, setFinalInstructions] = useState("");
  const [finalNpcInstructions, setFinalNpcInstructions] = useState("");
  const [aiDraftMode, setAiDraftMode] = useState<"pc" | "npc">("pc");
  const [aiDraftPrompt, setAiDraftPrompt] = useState("");

  const draft = state.draft;

  // Stable per-Draft generation seed: reused across style changes so the same
  // confirmed Draft resolves identical NPC values in Medieval and Sci-fi.
  const finalSeed = useMemo(
    () => (draft === null ? null : `final-${draft.draftId}`.slice(0, 64)),
    [draft],
  );

  const resolveSessionToken = useCallback(async (): Promise<string> => {
    return resolveV2SessionToken(BACKEND_MODE, props.sessionTokenProvider);
  }, [props.sessionTokenProvider]);

  const beginDraft = useCallback(
    async (makeDraft: (sessionId: string) => CharacterSheetDraftV2) => {
      setPending(true);
      setTransientError(null);
      try {
        await store.startSession(await resolveSessionToken());
        const sessionId = store.getState().sessionId;
        if (sessionId === null) {
          throw new Error("The session was not created.");
        }
        await store.createDraft(makeDraft(sessionId));
        setScreen("editing");
      } catch (error) {
        setTransientError(
          error instanceof Error
            ? error.message
            : "The session could not start.",
        );
      } finally {
        setPending(false);
      }
    },
    [store, resolveSessionToken],
  );

  const beginUploadedDraft = useCallback(
    async (file: SheetDocumentFileDescriptor): Promise<string | null> => {
      setPending(true);
      setTransientError(null);
      try {
        await store.startSession(await resolveSessionToken());
        const sessionId = store.getState().sessionId;
        const accessToken = store.getState().accessToken;
        if (sessionId === null || accessToken === null) {
          throw new Error("The session was not created.");
        }
        const extracted = await SHEET_EXTRACTION_V2.extractSheetDocument({
          sessionId,
          accessToken,
          file,
        });
        await store.createDraft(extracted);
        setScreen("editing");
        return null;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "The document could not be extracted.";
      } finally {
        setPending(false);
      }
    },
    [store, resolveSessionToken],
  );

  const handleChoose = useCallback(
    (id: string) => {
      if (id === "manual") {
        void beginDraft(createBlankDraftV2);
      } else if (id === "upload") {
        setModal("upload");
      } else if (id === "generate-ai") {
        setAiDraftPrompt("");
        setModal("generate-ai");
      }
    },
    [beginDraft],
  );

  const handleGenerateAiDraft = useCallback(async () => {
    const prompt = aiDraftPrompt.trim();
    if (prompt === "") {
      setTransientError("Describe the character before generating a draft.");
      return;
    }
    setPending(true);
    setTransientError(null);
    try {
      await store.startSession(await resolveSessionToken());
      const outcome = await store.generateAiDraft({
        mode: aiDraftMode,
        prompt: prompt.slice(0, 5000),
      });
      if (outcome.kind === "ok") {
        setModal("none");
        setScreen("editing");
      } else if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      } else {
        setTransientError("The AI draft could not be created.");
      }
    } catch (error) {
      setTransientError(
        error instanceof Error
          ? error.message
          : "The AI draft could not be created.",
      );
    } finally {
      setPending(false);
    }
  }, [aiDraftMode, aiDraftPrompt, store, resolveSessionToken]);

  const applyMutation = useCallback(
    async (mutation: DraftMutationV2) => {
      const outcome = await store.applyMutation(mutation);
      if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      } else if (outcome.kind === "ok") {
        setTransientError(null);
      }
      return outcome;
    },
    [store],
  );

  const handleRename = useCallback(
    (title: string) => {
      void applyMutation(
        title === ""
          ? { op: "clear_value", key: "character_name" }
          : { op: "set_value", key: "character_name", value: title },
      );
    },
    [applyMutation],
  );

  const handleSetValue = useCallback(
    (key: string, value: DraftValue) => {
      void applyMutation({ op: "set_value", key, value });
    },
    [applyMutation],
  );

  const handleClearValue = useCallback(
    (key: string) => {
      void applyMutation({ op: "clear_value", key });
    },
    [applyMutation],
  );

  const handleRemoveField = useCallback((key: string) => {
    setDeleteTarget({ kind: "field", key });
    setModal("delete-field");
  }, []);

  const handleConfirmDeleteField = useCallback(
    async (key: string) => {
      setDeleteTarget(null);
      const outcome = await applyMutation({ op: "remove_field", key });
      if (outcome.kind === "ok") {
        setModal("none");
      }
    },
    [applyMutation],
  );

  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
    setModal("none");
  }, []);

  const handleRemoveSection = useCallback((key: string) => {
    setDeleteTarget({ kind: "section", key });
    setModal("delete-section");
  }, []);

  const handleConfirmDeleteSection = useCallback(
    async (key: string) => {
      setDeleteTarget(null);
      const outcome = await applyMutation({ op: "remove_section", key });
      if (outcome.kind === "ok") {
        setModal("none");
      }
    },
    [applyMutation],
  );

  const handleAddPortraitSlot = useCallback(() => {
    void applyMutation({ op: "add_portrait_slot", key: "portrait" });
  }, [applyMutation]);

  const handleRemovePortraitSlot = useCallback(
    (key: string) => {
      void applyMutation({ op: "remove_portrait_slot", key });
    },
    [applyMutation],
  );

  const handleSetPortraitAspectRatio = useCallback(
    (key: string, aspectRatio: "1:1" | "3:4" | "4:5" | "16:9") => {
      void applyMutation({ op: "set_portrait_aspect_ratio", key, aspectRatio });
    },
    [applyMutation],
  );

  const handleUndo = useCallback(async () => {
    if (!draft) return;
    setPending(true);
    setTransientError(null);
    try {
      const outcome = await store.undo();
      if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      } else if (outcome.kind === "ok") {
        setTransientError(null);
      }
    } finally {
      setPending(false);
    }
  }, [store, draft]);

  const handleSetFieldLabel = useCallback(
    (key: string, label: string) => {
      void applyMutation({ op: "set_field_label", key, label });
    },
    [applyMutation],
  );

  const handleSetFieldType = useCallback(
    (field: Extract<DraftMutationV2, { op: "set_field_type" }>["field"]) => {
      void applyMutation({ op: "set_field_type", field });
    },
    [applyMutation],
  );

  /**
   * Narrow UI guard only: `character_name` must stay a text field so a later
   * reroll can never draw a numeric name. The domain enforces the same rule
   * authoritatively; this guard only surfaces it early in the editor.
   */
  const handleSetFieldTypeGuarded = useCallback(
    (field: Extract<DraftMutationV2, { op: "set_field_type" }>["field"]) => {
      const current = draft?.fields.find((entry) => entry.key === field.key);
      if (current?.key === "character_name" && field.type !== "text") {
        setTransientError("The character name field must stay a text field.");
        return;
      }
      handleSetFieldType(field);
    },
    [draft, handleSetFieldType],
  );

  const handleAddSection = useCallback(
    async (result: AddSectionV2Result) => {
      // Two authoritative mutations by design: create the Section at the
      // root, then place it inside the chosen parent if one was selected.
      const created = await store.applyMutation({
        op: "add_section",
        section: result.section,
      });
      if (created.kind !== "ok") {
        if (created.kind === "rejected") setTransientError(created.message);
        else if (created.kind === "error")
          setTransientError(created.error.message);
        return;
      }
      if (result.parentKey !== null) {
        const placed = await store.applyMutation({
          op: "place_node",
          key: result.section.key,
          destination: { position: "inside", parentKey: result.parentKey },
        });
        if (placed.kind === "rejected") {
          // Keep the successfully created root Section; reconcile below.
          setTransientError(placed.message);
        } else if (placed.kind === "error") {
          setTransientError(placed.error.message);
        } else {
          setTransientError(null);
        }
      } else {
        setTransientError(null);
      }
    },
    [store],
  );

  const handleRenameSection = useCallback(
    (key: string, title: string) => {
      void applyMutation({ op: "rename_section", key, title });
    },
    [applyMutation],
  );

  const handlePlaceNode = useCallback(
    (
      key: string,
      destination: Extract<
        DraftMutationV2,
        { op: "place_node" }
      >["destination"],
    ) => {
      void applyMutation({ op: "place_node", key, destination });
    },
    [applyMutation],
  );

  const handleSetContainerLayout = useCallback(
    (containerKey: string | null, columns: number) => {
      void applyMutation({ op: "set_container_layout", containerKey, columns });
    },
    [applyMutation],
  );

  const handleSetNodeLayout = useCallback(
    (key: string, placement: DraftLayoutNodeV1) => {
      void applyMutation({ op: "set_node_layout", key, placement });
    },
    [applyMutation],
  );

  const handleAddField = useCallback(
    async (field: DraftAddFieldV2Input): Promise<string | null> => {
      const outcome = await store.applyMutation({ op: "add_field", field });
      if (outcome.kind === "rejected") {
        return outcome.message;
      }
      if (outcome.kind === "error") {
        return outcome.error.message;
      }
      setTransientError(null);
      return null;
    },
    [store],
  );

  const handleConfirm = useCallback(async () => {
    setPending(true);
    setTransientError(null);
    try {
      const outcome = await store.confirm();
      if (outcome.kind === "ok") {
        setModal("none");
        setScreen("exported");
      } else if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      }
    } finally {
      setPending(false);
    }
  }, [store]);

  const handleRestart = useCallback(() => {
    store.reset();
    setScreen("landing");
    setModal("none");
    setTransientError(null);
    setPending(false);
    setSelection(null);
  }, [store]);

  const handleDownload = useCallback(async () => {
    if (draft === null) return;
    setPending(true);
    setTransientError(null);
    try {
      await downloadConfirmedDraftPdfV2(draft);
    } catch (error) {
      setTransientError(
        error instanceof Error
          ? error.message
          : "The PDF could not be created.",
      );
    } finally {
      setPending(false);
    }
  }, [draft]);

  const handleGenerateFinal = useCallback(async () => {
    if (draft === null || finalSeed === null) return;
    setPending(true);
    setTransientError(null);
    try {
      const instructions =
        finalInstructions.trim() === "" ? null : finalInstructions.slice(0, 5000);
      const npcInstructions =
        draft.mode !== "npc" || finalNpcInstructions.trim() === ""
          ? null
          : finalNpcInstructions.slice(0, 5000);
      const outcome = await store.generateFinalSheet({
        threat: state.workshop.threatLevel,
        visualStyle: finalStyle as VisualStyleKey,
        instructions,
        npcInstructions,
        seed: finalSeed,
      });
      if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      } else if (outcome.kind === "ok") {
        setTransientError(null);
      }
    } finally {
      setPending(false);
    }
  }, [draft, finalSeed, finalStyle, finalInstructions, finalNpcInstructions, state.workshop.threatLevel, store]);

  const handleDownloadFinalPdf = useCallback(async () => {
    setPending(true);
    setTransientError(null);
    try {
      const bytes = await store.downloadFinalPdf();
      if (bytes === null) {
        setTransientError("The final PDF is not ready yet.");
        return;
      }
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${draft?.characterName ?? "character-sheet"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setTransientError(
        error instanceof Error
          ? error.message
          : "The final PDF could not be downloaded.",
      );
    } finally {
      setPending(false);
    }
  }, [draft, store]);

  const handleWorkshopPreferences = useCallback(
    (patch: WorkshopIdentityPatch) => {
      if (patch.mode && draft) {
        // Mode change: use authoritative set_mode mutation
        void store.applyMutation({
          op: "set_mode",
          mode: patch.mode,
        });
      } else if (patch.threatLevel !== undefined) {
        // Threat level change: update workshop preferences
        store.setWorkshopPreferences({ threatLevel: patch.threatLevel });
      }
    },
    [store, draft],
  );

  const getThreatLevel = useCallback((): ThreatLevelPreference | null => {
    return state.workshop.threatLevel;
  }, [state.workshop.threatLevel]);

  const canvasCallbacks = useMemo(
    () => ({
      onSetValue: handleSetValue,
      onClearValue: handleClearValue,
      onRemoveField: handleRemoveField,
      onConfirmDeleteField: handleConfirmDeleteField,
      onCancelDelete: handleCancelDelete,
      onRemoveSection: handleRemoveSection,
      onConfirmDeleteSection: handleConfirmDeleteSection,
      onSetFieldLabel: handleSetFieldLabel,
      onSetFieldType: handleSetFieldTypeGuarded,
      onRenameSection: handleRenameSection,
      onPlaceNode: handlePlaceNode,
      onSetContainerLayout: handleSetContainerLayout,
      onSetNodeLayout: handleSetNodeLayout,
      onAddField: () => setModal("add-field"),
      onOpenAddSection: () => setModal("add-section"),
      onRemovePortraitSlot: handleRemovePortraitSlot,
      onSetPortraitAspectRatio: handleSetPortraitAspectRatio,
    }),
    [
      handleSetValue,
      handleClearValue,
      handleRemoveField,
      handleConfirmDeleteField,
      handleCancelDelete,
      handleRemoveSection,
      handleConfirmDeleteSection,
      handleSetFieldLabel,
      handleSetFieldTypeGuarded,
      handleRenameSection,
      handlePlaceNode,
      handleSetContainerLayout,
      handleSetNodeLayout,
      handleRemovePortraitSlot,
      handleSetPortraitAspectRatio,
    ],
  );

  const labelOf = useCallback(
    (key: string): string => {
      const fieldLabel = draft?.fields.find((entry) => entry.key === key)?.label;
      if (fieldLabel !== undefined) return fieldLabel;
      const sectionTitle = draft?.sections.find((entry) => entry.key === key)?.title;
      if (sectionTitle !== undefined) return sectionTitle;
      if ((draft?.slots ?? []).some((entry) => entry.key === key)) return "Portrait";
      return key;
    },
    [draft],
  );

  const hasPortraitSlot = (draft?.slots ?? []).length > 0;

  const [portraitPreviewUrl, setPortraitPreviewUrl] = useState<string | null>(null);
  const [portraitPreviewLoading, setPortraitPreviewLoading] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const portraitConfig = state.workshop.portrait;

  // Ephemeral browser preview: fetch protected bytes, render via object URL,
  // revoke when replaced or unmounted. Never persisted in Draft or Workshop.
  // All state updates happen in async continuations (never synchronously in
  // the effect body) so preview fetching cannot cascade renders.
  useEffect(() => {
    let cancelled = false;
    async function syncPortraitPreview(): Promise<void> {
      if (portraitConfig.kind === "none") {
        if (previewUrlRef.current !== null) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        if (!cancelled) {
          setPortraitPreviewUrl(null);
          setPortraitPreviewLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setPortraitPreviewLoading(true);
      }
      let result: Awaited<ReturnType<typeof store.downloadPortraitImage>>;
      try {
        result = await store.downloadPortraitImage(portraitConfig.assetId);
      } catch {
        result = null;
      }
      if (cancelled) return;
      if (result === null) {
        setPortraitPreviewUrl(null);
        setPortraitPreviewLoading(false);
        return;
      }
      const blob = new Blob([result.bytes.buffer as ArrayBuffer], {
        type: result.mimeType,
      });
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = url;
      setPortraitPreviewUrl(url);
      setPortraitPreviewLoading(false);
    }
    void syncPortraitPreview();
    return () => {
      cancelled = true;
    };
  }, [portraitConfig, store]);

  useEffect(
    () => () => {
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  const portraitHandlers = useMemo(
    () => ({
      onUpload: async (file: File) => {
        const outcome = await store.uploadPortraitImage(file);
        return { kind: outcome.kind };
      },
      onImportUrl: async (url: string) => {
        const outcome = await store.importPortraitUrl(url);
        return { kind: outcome.kind };
      },
      onGenerate: async (prompt: string) => {
        const outcome = await store.generatePortraitImage(prompt);
        return { kind: outcome.kind };
      },
      onSelectNone: () => {
        store.setWorkshopPreferences({ portrait: { kind: "none" } });
      },
    }),
    [store],
  );

  return (
    <div className="character-workshop__workspace">
      {screen === "landing" && (
        <CreationModeSelector
          eyebrow="RPG Forge — Character Workshop"
          title="How do you want to create your character?"
          subtitle="Turn a document or a blank sheet into a character sheet. Work stays temporary and tied to this session — nothing is saved permanently. Confirming locks the sheet as read-only before you export it."
          choices={LANDING_CHOICES}
          busy={pending}
          error={transientError ?? state.error?.message ?? null}
          onChoose={handleChoose}
        >
          <button
            type="button"
            className="character-workshop__dev-link"
            onClick={() => void beginDraft(createExampleDraftV2)}
            disabled={pending}
          >
            Developer: load a test example
          </button>
        </CreationModeSelector>
      )}

      {screen === "editing" && draft !== null && (
        <>
          <WorkshopToolbar
            draft={draft}
            saveStatus={state.saveStatus}
            busy={pending || state.saveStatus === "saving"}
            onRename={handleRename}
            onAddField={() => setModal("add-field")}
            onConfirm={() => setModal("confirm")}
            onRestart={handleRestart}
            onUndo={handleUndo}
            undoAvailable={state.undoAvailable}
          />
          <div className="character-workshop__identity-bar">
            <WorkshopIdentitySelector
              mode={draft.mode}
              threatLevel={getThreatLevel()}
              disabled={
                draft.confirmed || pending || state.saveStatus === "saving"
              }
              onChange={handleWorkshopPreferences}
            />
            {!draft.confirmed && !hasPortraitSlot && (
              <button
                type="button"
                className="character-workshop__btn character-workshop__btn--secondary"
                onClick={handleAddPortraitSlot}
                disabled={pending || state.saveStatus === "saving"}
              >
                Add portrait
              </button>
            )}
            <WorkshopPortraitSelector
              hasSlot={hasPortraitSlot}
              portrait={portraitConfig}
              disabled={draft.confirmed || pending || state.saveStatus === "saving"}
              busy={pending}
              previewUrl={portraitPreviewUrl}
              previewLoading={portraitPreviewLoading}
              handlers={portraitHandlers}
            />
          </div>
          {transientError !== null && (
            <p className="character-workshop__alert" role="alert">
              {transientError}
            </p>
          )}
          <div className="character-workshop__layout">
            <SheetCanvasV2
              draft={draft}
              callbacks={canvasCallbacks}
              disabled={draft.confirmed}
              selection={selection}
              onSelectionChange={setSelection}
            />
            <div className="character-workshop__inspector-column">
              <CanvasInspectorV2
                draft={draft}
                selection={selection}
                callbacks={canvasCallbacks}
                disabled={draft.confirmed}
                labelOf={labelOf}
              />
            </div>
          </div>
        </>
      )}

      {screen === "exported" && draft !== null && (
        <>
          <div className="character-workshop__confirm-banner">
            This sheet is confirmed and read-only. No further changes can be
            made.
          </div>
          <div className="character-workshop__layout">
            <div className="character-workshop__preview-column">
              <SheetPreviewV2 draft={draft} />
            </div>
          </div>
          <div
            className="character-workshop__final-panel"
            aria-label="Final sheet generation"
          >
            <h2 className="character-workshop__final-title">Final sheet</h2>
            <p className="character-workshop__final-hint">
              Choose a presentation style, then generate the final styled sheet
              with AI. The confirmed draft itself never changes.
            </p>
            <div className="character-workshop__identity-field">
              <span
                className="character-workshop__identity-label"
                id="workshop-final-style-label"
              >
                Style
              </span>
              <div
                className="character-workshop__identity-segment"
                role="group"
                aria-labelledby="workshop-final-style-label"
              >
                {(["medieval", "sci-fi"] as const).map((option) => {
                  const selected = finalStyle === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={
                        selected
                          ? "character-workshop__identity-option character-workshop__identity-option--selected"
                          : "character-workshop__identity-option"
                      }
                      aria-pressed={selected}
                      onClick={() => setFinalStyle(option)}
                      disabled={pending || state.finalGeneration.status === "generating"}
                    >
                      {option === "medieval" ? "Medieval" : "Sci-fi"}
                    </button>
                  );
                })}
              </div>
              <span className="character-workshop__final-note">
                Fantasy, Gothic, Steampunk and Contemporary arrive later.
              </span>
            </div>
            {draft.mode === "npc" && (
              <div className="character-workshop__identity-field">
                <span
                  className="character-workshop__identity-label"
                  id="workshop-final-threat-label"
                >
                  Threat
                </span>
                <div
                  className="character-workshop__identity-segment"
                  role="group"
                  aria-labelledby="workshop-final-threat-label"
                >
                  {THREAT_LEVEL_OPTIONS.map((option) => {
                    const selected = state.workshop.threatLevel === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={
                          selected
                            ? "character-workshop__identity-option character-workshop__identity-option--selected"
                            : "character-workshop__identity-option"
                        }
                        aria-pressed={selected}
                        title={THREAT_LEVEL_EXPLANATION[option]}
                        onClick={() =>
                          store.setWorkshopPreferences({
                            threatLevel: selected ? null : option,
                          })
                        }
                        disabled={pending || state.finalGeneration.status === "generating"}
                      >
                        {THREAT_LEVEL_LABEL[option]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <WorkshopPortraitSelector
              hasSlot={hasPortraitSlot}
              portrait={portraitConfig}
              disabled={pending || state.finalGeneration.status === "generating"}
              busy={pending || state.finalGeneration.status === "generating"}
              previewUrl={portraitPreviewUrl}
              previewLoading={portraitPreviewLoading}
              handlers={portraitHandlers}
            />
            <div className="character-workshop__identity-field">
              <label
                className="character-workshop__identity-label"
                htmlFor="workshop-final-instructions"
              >
                Presentation instructions (optional)
              </label>
              <textarea
                id="workshop-final-instructions"
                className="character-workshop__final-textarea"
                value={finalInstructions}
                maxLength={5000}
                rows={3}
                placeholder="Keep the design restrained and readable when printed."
                onChange={(event) => setFinalInstructions(event.target.value)}
                disabled={pending || state.finalGeneration.status === "generating"}
              />
              <span className="character-workshop__final-note">
                Presentation guidance only — it never changes field values. A
                request like “make Strength high” will not change Strength.
              </span>
            </div>
            {draft.mode === "npc" && (
              <div className="character-workshop__identity-field">
                <label
                  className="character-workshop__identity-label"
                  htmlFor="workshop-final-npc-instructions"
                >
                  NPC generation instructions (optional)
                </label>
                <textarea
                  id="workshop-final-npc-instructions"
                  className="character-workshop__final-textarea"
                  value={finalNpcInstructions}
                  maxLength={5000}
                  rows={3}
                  placeholder="Big and clumsy: high Strength, low agility."
                  onChange={(event) => setFinalNpcInstructions(event.target.value)}
                  disabled={pending || state.finalGeneration.status === "generating"}
                />
                <span className="character-workshop__final-note">
                  Describe how remaining blank character values should be
                  oriented. Explicit values will never be changed.
                </span>
              </div>
            )}
            {state.finalGeneration.status === "error" &&
              state.finalGeneration.error !== null && (
                <p className="character-workshop__alert" role="alert">
                  {state.finalGeneration.error.message}
                </p>
              )}
            {state.finalGeneration.status === "generating" && (
              <p className="character-workshop__final-status" role="status">
                Generating the final sheet…
              </p>
            )}
            <div className="character-workshop__controls">
              <button
                type="button"
                className="character-workshop__btn"
                onClick={() => void handleGenerateFinal()}
                disabled={
                  pending ||
                  state.finalGeneration.status === "generating" ||
                  (draft.mode === "npc" && state.workshop.threatLevel === null)
                }
              >
                Generate Final Sheet with AI
              </button>
              <button
                type="button"
                className="character-workshop__btn"
                onClick={() => void handleDownloadFinalPdf()}
                disabled={
                  pending || state.finalGeneration.status !== "ready"
                }
              >
                Download Final PDF
              </button>
              <button
                type="button"
                className="character-workshop__btn character-workshop__btn--ghost"
                onClick={() => void handleDownload()}
                disabled={pending}
                title="Technical debug export (un-styled layout preview)"
              >
                Download technical PDF
              </button>
              <button
                type="button"
                className="character-workshop__btn character-workshop__btn--ghost"
                onClick={handleRestart}
              >
                Start a new sheet
              </button>
            </div>
          </div>
        </>
      )}

      <UploadSheetDialog
        key={modal === "upload" ? "open" : "closed"}
        open={modal === "upload"}
        busy={pending}
        error={transientError}
        onClose={() => setModal("none")}
        onSubmit={beginUploadedDraft}
      />
      <GenerateAiDraftDialog
        open={modal === "generate-ai"}
        mode={aiDraftMode}
        prompt={aiDraftPrompt}
        busy={pending || state.aiDraft.status === "generating"}
        error={transientError ?? state.aiDraft.error?.message ?? null}
        onModeChange={setAiDraftMode}
        onPromptChange={setAiDraftPrompt}
        onClose={() => setModal("none")}
        onSubmit={() => void handleGenerateAiDraft()}
      />
      <AddFieldDialog
        open={modal === "add-field"}
        onClose={() => setModal("none")}
        onSubmit={handleAddField}
        existingKeys={draft?.fields.map((field) => field.key) ?? []}
      />
      <AddSectionDialogV2
        open={modal === "add-section"}
        sections={draft?.sections ?? []}
        onClose={() => setModal("none")}
        onSubmit={(result) => void handleAddSection(result)}
      />
      <ConfirmDialog
        open={modal === "confirm"}
        title={draft?.characterName ?? "Untitled sheet"}
        busy={pending}
        error={transientError}
        onConfirm={() => void handleConfirm()}
        onClose={() => setModal("none")}
      />
      <DestructiveConfirmDialog
        open={modal === "delete-field"}
        title="Delete field"
        message="This will permanently remove the field and its value from the sheet. This cannot be undone."
        busy={pending}
        error={transientError}
        onConfirm={() => {
          if (deleteTarget?.kind === "field") {
            void handleConfirmDeleteField(deleteTarget.key);
          }
        }}
        onClose={handleCancelDelete}
      />
      <DestructiveConfirmDialog
        open={modal === "delete-section"}
        title="Delete section"
        message="This will permanently remove the section. The section must be empty (no fields or sub-sections) to be deleted."
        busy={pending}
        error={transientError}
        onConfirm={() => {
          if (deleteTarget?.kind === "section") {
            void handleConfirmDeleteSection(deleteTarget.key);
          }
        }}
        onClose={handleCancelDelete}
      />
    </div>
  );
}
