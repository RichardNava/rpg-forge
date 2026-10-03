"use client";

import { useCallback, useState } from "react";
import type {
  CharacterSheetDraftV2,
  DraftMutationV2,
  DraftValue,
} from "@repo/character-sheet-draft";
import type { DraftAddFieldV2Input } from "./AddFieldDialog";
import { SheetApiClientV2 } from "../api/sheet-api-client-v2";
import type { SheetApiClientV2Port } from "../api/sheet-api-client-v2";
import { createLocalSheetBackendV2 } from "../lib/local-sheet-backend-v2";
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
import { WorkshopSidebarV2 } from "./WorkshopSidebarV2";
import { SheetPreviewV2 } from "./SheetPreviewV2";
import { AddFieldDialog } from "./AddFieldDialog";
import {
  AddSectionDialogV2,
  type AddSectionV2Result,
} from "./AddSectionDialogV2";
import { ConfirmDialog } from "./ConfirmDialog";
import { UploadSheetDialog } from "./UploadSheetDialog";
import { WorkshopIdentitySelector } from "./WorkshopIdentitySelector";
import type { WorkshopIdentityPatch } from "./WorkshopIdentitySelector";

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

const BACKEND_MODE = (
  process.env.NEXT_PUBLIC_CHARACTER_SHEET_BACKEND ??
  (process.env.NODE_ENV === "test" ? "local" : "remote")
)
  .trim()
  .toLowerCase();
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

export function CharacterWorkshopV2(props: CharacterWorkshopV2Props = {}) {
  const [store] = useState<SheetStoreV2>(() =>
    createSheetStoreV2({ api: createWorkshopBackendV2() }),
  );
  const state = useSheetStoreV2(store);
  const [screen, setScreen] = useState<WorkshopScreen>("landing");
  const [modal, setModal] = useState<WorkshopModal>("none");
  const [pending, setPending] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);

  const draft = state.draft;

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
      }
    },
    [beginDraft],
  );

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
    (field: Extract<DraftMutationV2, { op: "set_field_type" }>["field"]) => {
      void applyMutation({ op: "set_field_type", field });
    },
    [applyMutation],
  );

  /**
   * Narrow UI guard only: `character_name` must stay a text field so a later
   * reroll can never draw a numeric name. This does NOT replace the
   * authoritative domain fix, which remains 4E5 pre-activation work.
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
          <WorkshopSidebarV2
            draft={draft}
            callbacks={{
              onSetValue: handleSetValue,
              onClearValue: handleClearValue,
              onRemoveField: handleRemoveField,
              onSetFieldLabel: handleSetFieldLabel,
              onSetFieldType: handleSetFieldTypeGuarded,
              onRenameSection: handleRenameSection,
              onPlaceNode: handlePlaceNode,
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
              <SheetPreviewV2 draft={draft} />
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
    </div>
  );
}
