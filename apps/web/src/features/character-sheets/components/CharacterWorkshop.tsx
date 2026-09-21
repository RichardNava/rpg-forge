"use client";

import { useCallback, useState } from "react";
import type {
  CharacterSheetDraft,
  DraftAddField,
  DraftMutation,
  DraftValue,
} from "@repo/character-sheet-draft";
import { SheetApiClient } from "../api/sheet-api-client";
import type { SheetApiClientPort } from "../api/sheet-api-client";
import { createLocalSheetBackend } from "../lib/local-sheet-backend";
import { createBlankDraft, createExampleDraft } from "../lib/dev-fixture";
import { createLocalSheetDocumentExtractionService } from "../extraction/local-extraction-service";
import { createRemoteSheetDocumentExtractionService } from "../extraction/remote-extraction-service";
import { downloadConfirmedDraftPdf } from "../export/export-confirmed-draft-pdf";
import type {
  SheetDocumentExtractionService,
  SheetDocumentFileDescriptor,
} from "../extraction/extraction-service";
import { createSheetStore } from "../state/sheet-store";
import type { SheetStore } from "../state/sheet-store-types";
import { useSheetStore } from "../hooks/use-sheet-store";
import { CreationModeSelector } from "./CreationModeSelector";
import { WorkshopToolbar } from "./WorkshopToolbar";
import { WorkshopSidebar } from "./WorkshopSidebar";
import { SheetPreview } from "./SheetPreview";
import { AddFieldDialog } from "./AddFieldDialog";
import { AddSectionDialog } from "./AddSectionDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { UploadSheetDialog } from "./UploadSheetDialog";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";
import type { WorkshopIdentityPatch } from "./WorkshopIdentitySelector";

const BACKEND_MODE = (
  process.env.NEXT_PUBLIC_CHARACTER_SHEET_BACKEND ??
  (process.env.NODE_ENV === "test" ? "local" : "remote")
)
  .trim()
  .toLowerCase();

function createWorkshopBackend(): SheetApiClientPort {
  if (BACKEND_MODE === "remote") {
    return new SheetApiClient();
  }
  return createLocalSheetBackend();
}

/**
 * Production always uses the protected Worker endpoint. `local` is retained
 * only for explicit isolated-development tests and never simulates OCR.
 */
const SHEET_EXTRACTION: SheetDocumentExtractionService =
  BACKEND_MODE === "remote"
    ? createRemoteSheetDocumentExtractionService()
    : createLocalSheetDocumentExtractionService();

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
    title: "Generate with AI",
    description:
      "Create a new character concept. AI generation arrives in a later phase.",
    cta: "Coming soon",
    badge: "Soon",
    disabled: true,
  },
];

type WorkshopScreen = "landing" | "editing" | "exported";
type WorkshopModal =
  "none" | "add-field" | "add-section" | "confirm" | "upload";

export function CharacterWorkshop() {
  const [store] = useState<SheetStore>(() =>
    createSheetStore({ api: createWorkshopBackend() }),
  );
  const state = useSheetStore(store);
  const [screen, setScreen] = useState<WorkshopScreen>("landing");
  const [modal, setModal] = useState<WorkshopModal>("none");
  const [pending, setPending] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);

  const draft = state.draft;

  const beginDraft = useCallback(
    async (makeDraft: (sessionId: string) => CharacterSheetDraft) => {
      setPending(true);
      setTransientError(null);
      try {
        await store.startSession("local-turnstile-bypass");
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
    [store],
  );

  const beginUploadedDraft = useCallback(
    async (file: SheetDocumentFileDescriptor): Promise<string | null> => {
      setPending(true);
      setTransientError(null);
      try {
        await store.startSession("local-turnstile-bypass");
        const sessionId = store.getState().sessionId;
        const accessToken = store.getState().accessToken;
        if (sessionId === null || accessToken === null) {
          throw new Error("The session was not created.");
        }
        const draft = await SHEET_EXTRACTION.extractSheetDocument({
          sessionId,
          accessToken,
          file,
        });
        await store.createDraft(draft);
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
    [store],
  );

  const handleChoose = useCallback(
    (id: string) => {
      if (id === "manual") {
        void beginDraft(createBlankDraft);
      } else if (id === "upload") {
        setModal("upload");
      }
    },
    [beginDraft],
  );

  const applyMutation = useCallback(
    async (mutation: DraftMutation) => {
      const outcome = await store.applyMutation(mutation);
      if (outcome.kind === "rejected") {
        setTransientError(outcome.message);
      } else if (outcome.kind === "error") {
        setTransientError(outcome.error.message);
      } else if (outcome.kind === "ok") {
        setTransientError(null);
      }
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

  const handleRemoveField = useCallback(
    (key: string) => {
      void applyMutation({ op: "remove_field", key });
    },
    [applyMutation],
  );

  const handleSetFieldLabel = useCallback(
    (key: string, label: string) => {
      void applyMutation({ op: "set_field_label", key, label });
    },
    [applyMutation],
  );

  const handleSetFieldType = useCallback(
    (field: Extract<DraftMutation, { op: "set_field_type" }>["field"]) => {
      void applyMutation({ op: "set_field_type", field });
    },
    [applyMutation],
  );

  const handleAddSection = useCallback(
    (section: Extract<DraftMutation, { op: "add_section" }>["section"]) => {
      void applyMutation({ op: "add_section", section });
    },
    [applyMutation],
  );

  const handleRenameSection = useCallback(
    (key: string, title: string) => {
      void applyMutation({ op: "rename_section", key, title });
    },
    [applyMutation],
  );

  const handleMoveField = useCallback(
    (key: string, sectionKey: string | null) => {
      void applyMutation({ op: "move_field", key, sectionKey });
    },
    [applyMutation],
  );

  const handleReparentSection = useCallback(
    (key: string, parentKey: string | null) => {
      void applyMutation({ op: "reparent_section", key, parentKey });
    },
    [applyMutation],
  );

  const handleAddField = useCallback(
    async (field: DraftAddField): Promise<string | null> => {
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
  }, [store]);

  const handleDownload = useCallback(async () => {
    if (draft === null) return;
    setPending(true);
    setTransientError(null);
    try {
      await downloadConfirmedDraftPdf(draft);
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

  const handleWorkshopPreferences = useCallback(
    (patch: WorkshopIdentityPatch) => {
      store.setWorkshopPreferences(patch);
    },
    [store],
  );

  return (
    <div className="character-workshop__workspace">
      {screen === "landing" && (
        <CreationModeSelector
          eyebrow="RPG Forge — Character Workshop"
          title="How do you want to create your character?"
          subtitle="Turn a document or a blank sheet into a character sheet. Everything stays in your browser until you export it; confirming locks the sheet as read-only."
          choices={LANDING_CHOICES}
          busy={pending}
          error={transientError ?? state.error?.message ?? null}
          onChoose={handleChoose}
        >
          <button
            type="button"
            className="character-workshop__dev-link"
            onClick={() => void beginDraft(createExampleDraft)}
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
          />
          <div className="character-workshop__identity-bar">
            <WorkshopIdentitySelector
              characterType={state.workshop.characterType}
              threatLevel={state.workshop.threatLevel}
              disabled={
                draft.confirmed || pending || state.saveStatus === "saving"
              }
              onChange={handleWorkshopPreferences}
            />
          </div>
          {transientError !== null && (
            <p className="character-workshop__alert" role="alert">
              {transientError}
            </p>
          )}
          <WorkshopSidebar
            draft={draft}
            callbacks={{
              onSetValue: handleSetValue,
              onClearValue: handleClearValue,
              onRemoveField: handleRemoveField,
              onSetFieldLabel: handleSetFieldLabel,
              onSetFieldType: handleSetFieldType,
              onAddSection: handleAddSection,
              onRenameSection: handleRenameSection,
              onMoveField: handleMoveField,
              onReparentSection: handleReparentSection,
              onAddField: () => setModal("add-field"),
              onOpenAddSection: () => setModal("add-section"),
            }}
            disabled={draft.confirmed}
          />
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
              <SheetPreview draft={draft} />
            </div>
          </div>
          <div className="character-workshop__controls">
            <button
              type="button"
              className="character-workshop__btn"
              onClick={() => void handleDownload()}
              disabled={pending}
            >
              Download PDF
            </button>
            <button
              type="button"
              className="character-workshop__btn character-workshop__btn--ghost"
              onClick={handleRestart}
            >
              Start a new sheet
            </button>
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
      <AddFieldDialog
        open={modal === "add-field"}
        onClose={() => setModal("none")}
        onSubmit={handleAddField}
        existingKeys={draft?.fields.map((field) => field.key) ?? []}
      />
      <AddSectionDialog
        open={modal === "add-section"}
        sections={draft?.sections ?? []}
        onClose={() => setModal("none")}
        onSubmit={handleAddSection}
      />
      <ConfirmDialog
        open={modal === "confirm"}
        title={draft?.characterName ?? "Untitled sheet"}
        busy={pending}
        error={transientError}
        onConfirm={() => void handleConfirm()}
        onClose={() => setModal("none")}
      />
    </div>
  );
}
