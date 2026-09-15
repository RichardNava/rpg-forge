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
import { createSheetStore } from "../state/sheet-store";
import type { SheetStore } from "../state/sheet-store-types";
import { useSheetStore } from "../hooks/use-sheet-store";
import { CreationModeSelector } from "./CreationModeSelector";
import { WorkshopToolbar } from "./WorkshopToolbar";
import { WorkshopSidebar } from "./WorkshopSidebar";
import { SheetPreview } from "./SheetPreview";
import { AddFieldDialog } from "./AddFieldDialog";
import { ConfirmDialog } from "./ConfirmDialog";

const BACKEND_MODE = (
  process.env.NEXT_PUBLIC_CHARACTER_SHEET_BACKEND ?? "local"
)
  .trim()
  .toLowerCase();

function createWorkshopBackend(): SheetApiClientPort {
  if (BACKEND_MODE === "remote") {
    return new SheetApiClient();
  }
  return createLocalSheetBackend();
}

const LANDING_CHOICES = [
  {
    id: "manual",
    title: "Create manually",
    description:
      "Build a blank character sheet from scratch: add fields of any supported type, fill them in, and watch the preview update live.",
    cta: "Open the workshop",
  },
  {
    id: "example",
    title: "Load an example",
    badge: "Dev",
    description:
      "Start from a pre-filled example sheet that exercises text, number, textarea, checkbox and choice fields.",
    cta: "Explore the editor",
  },
];

type WorkshopScreen = "landing" | "editing" | "exported";
type WorkshopModal = "none" | "add-field" | "confirm";

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

  const handleChoose = useCallback(
    (id: string) => {
      if (id === "manual") {
        void beginDraft(createBlankDraft);
      } else if (id === "example") {
        void beginDraft(createExampleDraft);
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

  return (
    <div className="character-workshop__workspace">
      {screen === "landing" && (
        <CreationModeSelector
          title="RPG Forge — Character sheets"
          subtitle="Shape parchment into a character sheet. Everything stays in your browser until you export it; confirming locks the sheet as read-only."
          choices={LANDING_CHOICES}
          busy={pending}
          error={transientError ?? state.error?.message ?? null}
          onChoose={handleChoose}
        />
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
          {transientError !== null && (
            <p className="character-workshop__alert" role="alert">
              {transientError}
            </p>
          )}
          <div className="character-workshop__layout">
            <div className="character-workshop__sidebar-column">
              <WorkshopSidebar
                draft={draft}
                callbacks={{
                  onSetValue: handleSetValue,
                  onClearValue: handleClearValue,
                  onRemoveField: handleRemoveField,
                  onAddField: () => setModal("add-field"),
                }}
                disabled={draft.confirmed}
              />
            </div>
            <div className="character-workshop__preview-column">
              <SheetPreview draft={draft} />
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
              <SheetPreview draft={draft} />
            </div>
          </div>
          <div className="character-workshop__controls">
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

      <AddFieldDialog
        open={modal === "add-field"}
        onClose={() => setModal("none")}
        onSubmit={handleAddField}
        existingKeys={draft?.fields.map((field) => field.key) ?? []}
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
