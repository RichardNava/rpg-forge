"use client";

import { useState } from "react";
import type { PortraitSource } from "../state/sheet-workshop-types";
import {
  PORTRAIT_SOURCE_LABEL,
  PORTRAIT_SOURCE_OPTIONS,
  type PortraitSourceKind,
} from "../lib/workshop-preferences";

export interface WorkshopPortraitHandlers {
  onUpload(file: File): Promise<{ kind: string }>;
  onImportUrl(url: string): Promise<{ kind: string }>;
  onGenerate(prompt: string): Promise<{ kind: string }>;
  onSelectNone(): void;
}

interface WorkshopPortraitSelectorProps {
  hasSlot: boolean;
  portrait: PortraitSource;
  disabled: boolean;
  busy: boolean;
  previewUrl: string | null;
  previewLoading: boolean;
  handlers: WorkshopPortraitHandlers;
}

/**
 * Compact portrait source selector (14.13). Exactly one source is active at
 * a time; a source switch only happens after the server confirms the new
 * asset, so a failed operation retains the previous valid config. Raw files,
 * data URLs and prompts never enter Workshop state — only `{ kind, assetId }`
 * references returned by the server.
 */
export function WorkshopPortraitSelector({
  hasSlot,
  portrait,
  disabled,
  busy,
  previewUrl,
  previewLoading,
  handlers,
}: WorkshopPortraitSelectorProps) {
  const [tab, setTab] = useState<PortraitSourceKind>(
    portrait.kind === "none" ? "upload" : portrait.kind,
  );
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!hasSlot) {
    return (
      <div className="character-workshop__identity-field">
        <span className="character-workshop__identity-label">Portrait</span>
        <p className="character-workshop__final-note">
          Add a Portrait Slot to enable portrait images.
        </p>
      </div>
    );
  }

  const activeKind: PortraitSourceKind = portrait.kind;
  const controlsDisabled = disabled || busy;

  async function run(
    action: () => Promise<{ kind: string }>,
    failureMessage: string,
  ): Promise<void> {
    setLocalError(null);
    try {
      const outcome = await action();
      if (outcome.kind !== "ok") {
        setLocalError(failureMessage);
      }
    } catch {
      setLocalError(failureMessage);
    }
  }

  return (
    <div className="character-workshop__identity-field">
      <span
        className="character-workshop__identity-label"
        id="workshop-portrait-source-label"
      >
        Portrait source
      </span>
      <div
        className="character-workshop__identity-segment"
        role="group"
        aria-labelledby="workshop-portrait-source-label"
      >
        {PORTRAIT_SOURCE_OPTIONS.map((option) => {
          const selected =
            option === "none" ? activeKind === "none" : tab === option;
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
              onClick={() => {
                if (option === "none") {
                  handlers.onSelectNone();
                } else {
                  setTab(option);
                }
              }}
              disabled={controlsDisabled}
            >
              {PORTRAIT_SOURCE_LABEL[option]}
            </button>
          );
        })}
      </div>

      {activeKind !== "none" && (
        <p className="character-workshop__final-note">
          Active source: {PORTRAIT_SOURCE_LABEL[activeKind]}. Choosing another
          source replaces it only after the new image is confirmed.
        </p>
      )}

      {tab === "upload" && activeKind !== "upload" && (
        <label className="character-workshop__form-field">
          <span>PNG or JPEG file</span>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            aria-label="Portrait image file"
            disabled={controlsDisabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file === undefined) return;
              void run(
                () => handlers.onUpload(file),
                "The portrait upload failed.",
              );
            }}
          />
        </label>
      )}

      {tab === "url" && activeKind !== "url" && (
        <div className="character-workshop__form-field">
          <label htmlFor="workshop-portrait-url">Image URL (HTTPS)</label>
          <input
            id="workshop-portrait-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/portrait.png"
            value={url}
            maxLength={2048}
            disabled={controlsDisabled}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--secondary"
            disabled={controlsDisabled || url.trim() === ""}
            onClick={() =>
              void run(
                () => handlers.onImportUrl(url.trim()),
                "The portrait URL import failed.",
              )
            }
          >
            Import URL
          </button>
        </div>
      )}

      {tab === "ai" && activeKind !== "ai" && (
        <div className="character-workshop__form-field">
          <label htmlFor="workshop-portrait-prompt">
            Portrait description
          </label>
          <textarea
            id="workshop-portrait-prompt"
            value={prompt}
            maxLength={2000}
            rows={3}
            placeholder="A scarred ranger with a braided beard."
            disabled={controlsDisabled}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <button
            type="button"
            className="character-workshop__btn character-workshop__btn--secondary"
            disabled={controlsDisabled || prompt.trim() === ""}
            onClick={() =>
              void run(
                () => handlers.onGenerate(prompt.trim()),
                "Portrait generation failed.",
              )
            }
          >
            Generate portrait
          </button>
        </div>
      )}

      {previewLoading && (
        <p className="character-workshop__final-note" role="status">
          Loading preview…
        </p>
      )}
      {!previewLoading && previewUrl !== null && activeKind !== "none" && (
        // eslint-disable-next-line @next/next/no-img-element -- ephemeral blob: object URL; next/image optimization cannot handle blob: URLs.
        <img
          src={previewUrl}
          alt="Portrait preview"
          className="character-workshop__portrait-preview"
          style={{ objectFit: "contain", maxWidth: "100%" }}
        />
      )}
      {!previewLoading && previewUrl === null && activeKind === "none" && (
        <div
          className="character-workshop__portrait-placeholder"
          aria-label="Empty portrait frame"
        >
          No portrait image.
        </div>
      )}

      {localError !== null && (
        <p className="character-workshop__alert" role="alert">
          {localError}
        </p>
      )}
    </div>
  );
}
