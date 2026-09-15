import {
  initialDraftVersion,
  type CharacterSheetDraft,
  type DraftField,
} from "@repo/character-sheet-draft";
import { validateSheetUploadFile } from "../lib/sheet-upload-validation";
import type {
  ExtractSheetDocumentInput,
  SheetDocumentExtractionService,
} from "./extraction-service";

export interface LocalSheetDocumentExtractionOptions {
  /** Simulated extraction latency in milliseconds (0 disables the delay). */
  delayMs?: number;
}

const EXTRACTION_DELAY_MS = 900;

/**
 * Placeholder document extraction. It intentionally performs no OCR or vision
 * work: it derives a minimal but valid draft surface from the file name and
 * records provenance back to the uploaded document. Swapping in the real
 * multimodal extraction backend replaces the body of this adapter while the
 * `SheetDocumentExtractionService` port, the workshop and the store stay as-is.
 */
export function createLocalSheetDocumentExtractionService(
  options: LocalSheetDocumentExtractionOptions = {},
): SheetDocumentExtractionService {
  const delayMs = options.delayMs ?? EXTRACTION_DELAY_MS;

  return {
    async extractSheetDocument({
      sessionId,
      file,
    }: ExtractSheetDocumentInput): Promise<CharacterSheetDraft> {
      const validation = validateSheetUploadFile({
        name: file.name,
        type: file.mimeType,
        size: file.size,
      });
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const displayName = deriveCharacterName(file.name);
      return initialDraftVersion({
        schemaVersion: "1",
        draftId: crypto.randomUUID(),
        sessionId,
        mode: "pc",
        characterName: displayName,
        rulesContextId: null,
        fields: extractedFields(),
        values: { character_name: displayName },
        source: { sourceSheetId: deriveSourceId(file.name), sourceRunId: null },
        confirmed: false,
      });
    },
  };
}

function extractedFields(): DraftField[] {
  return [
    {
      key: "character_name",
      label: "Character name",
      type: "text",
      locked: false,
    },
    {
      key: "description",
      label: "Description",
      type: "textarea",
      locked: false,
    },
  ];
}

function deriveCharacterName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const name = base === "" ? "Extracted character" : base;
  return name.length > 256 ? name.slice(0, 255).trim() : name;
}

function deriveSourceId(fileName: string): string {
  const slug = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  const candidate = slug === "" ? "extracted" : slug;
  return candidate.length > 128 ? candidate.slice(0, 128) : candidate;
}