import {
  projectDraftV2ToSpec,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { renderCharacterSheetPdf } from "@repo/character-sheet-pdf-renderer";

/**
 * Renders a confirmed V2 browser draft directly through the V2 projection.
 * This intentionally creates no server artifact: standalone sheets remain
 * temporary until downloaded. No V1 projection is involved.
 */
export async function downloadConfirmedDraftPdfV2(
  draft: CharacterSheetDraftV2,
): Promise<void> {
  if (!draft.confirmed) {
    throw new Error("Confirm the sheet before downloading it.");
  }

  const { bytes } = await renderCharacterSheetPdf({
    spec: projectDraftV2ToSpec(draft),
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
