import {
  CharacterSheetDraftV2Schema,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { CHARACTER_SHEET_API_PREFIX } from "../api/sheet-api-types";
import { normalizeImageToJpeg, renderPdfPageImages } from "./pdf-page-images";
import type {
  ExtractSheetDocumentInput,
  SheetDocumentExtractionServiceV2,
} from "./extraction-service-v2";

export interface RemoteSheetDocumentExtractionV2Options {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Parallel V2 transport adapter for the temporary Worker extraction endpoint.
 * It sends the original file as multipart data exactly like V1, but validates
 * the returned draft against the canonical V2 schema: a V1 payload is
 * rejected here rather than entering the V2 store.
 */
export function createRemoteSheetDocumentExtractionServiceV2(
  options: RemoteSheetDocumentExtractionV2Options = {},
): SheetDocumentExtractionServiceV2 {
  const baseUrl = options.baseUrl ?? CHARACTER_SHEET_API_PREFIX;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async extractSheetDocument({
      sessionId,
      accessToken,
      file,
    }: ExtractSheetDocumentInput): Promise<CharacterSheetDraftV2> {
      if (accessToken === undefined || file.blob === undefined) {
        throw new Error("The uploaded document cannot be sent for extraction.");
      }
      const form = new FormData();
      form.append("document", file.blob, file.name);
      if (file.sheetStartPage !== undefined) {
        form.append("sheetStartPage", String(file.sheetStartPage));
      }
      const pages =
        file.mimeType === "application/pdf"
          ? await renderPdfPageImages(file.blob, file.sheetStartPage)
          : [await normalizeImageToJpeg(file.blob)];
      for (const [index, page] of pages.entries()) {
        form.append("page", page, `page-${index + 1}.jpg`);
      }
      const response = await fetchImpl(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/extraction`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error(await extractionErrorMessage(response));
      }
      const parsed = CharacterSheetDraftV2Schema.safeParse(
        await response.json(),
      );
      if (!parsed.success) {
        throw new Error(
          "The extraction service returned an invalid character sheet.",
        );
      }
      return parsed.data;
    },
  };
}

async function extractionErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") {
      return body.error.message;
    }
  } catch {
    // Fall through to the user-safe generic message.
  }
  return "The document could not be extracted. Please try again.";
}
