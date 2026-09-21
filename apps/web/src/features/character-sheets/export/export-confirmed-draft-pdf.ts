import {
  projectDraftToSpec,
  type CharacterSheetDraft,
} from "@repo/character-sheet-draft";
import { renderCharacterSheetPdf } from "@repo/character-sheet-pdf-renderer";

/**
 * Renders the confirmed browser draft directly. This intentionally creates no
 * server artifact: standalone sheets remain temporary until downloaded.
 */
export async function downloadConfirmedDraftPdf(
  draft: CharacterSheetDraft,
): Promise<void> {
  if (!draft.confirmed) {
    throw new Error("Confirm the sheet before downloading it.");
  }

  const { bytes } = await renderCharacterSheetPdf({
    spec: projectDraftToSpec(draft),
  });
  const url = URL.createObjectURL(
    // Copy into a browser-owned ArrayBuffer. `pdf-lib` exposes ArrayBufferLike,
    // while Blob only accepts the non-shared browser buffer variant.
    new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName(draft.characterName ?? "character-sheet")}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function fileName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "character-sheet";
}
