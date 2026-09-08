import {
  CHUNK_OVERLAP_CHARS,
  ExtractionArtifactSchema,
  MAX_CHUNK_TEXT_CHARS,
  MAX_PAGE_TEXT_CHARS,
  MAX_RULEBOOK_CHUNKS,
  MAX_TOTAL_EXTRACTED_CHARS,
  MIN_AVERAGE_TEXT_CHARS_PER_PAGE,
  MIN_MEANINGFUL_PAGE_CHARS,
  MIN_MEANINGFUL_PAGE_RATIO,
  MIN_TOTAL_TEXT_CHARS,
  RULEBOOK_ARTIFACT_VERSION,
  RulebookChunkSchema,
  TARGET_CHUNK_TEXT_CHARS,
  type ExtractionArtifact,
  type ExtractedPage,
  type RulebookChunk,
} from "./model.js";

export type ExtractionBuildResult =
  | {
      kind: "ok";
      artifact: ExtractionArtifact;
      extractedChars: number;
    }
  | { kind: "too_large" };

export function buildExtractionArtifact(input: {
  analysisId: string;
  ingestionId: string;
  pageCount: number;
  pages: readonly ExtractedPage[];
}): ExtractionBuildResult {
  let extractedChars = 0;
  const pages: ExtractedPage[] = [];

  for (const page of input.pages) {
    const text = normalizeExtractedText(page.text);
    if (text.length > MAX_PAGE_TEXT_CHARS) {
      return { kind: "too_large" };
    }
    extractedChars += text.length;
    if (extractedChars > MAX_TOTAL_EXTRACTED_CHARS) {
      return { kind: "too_large" };
    }
    pages.push({ pageNumber: page.pageNumber, text });
  }

  const parsed = ExtractionArtifactSchema.safeParse({
    version: RULEBOOK_ARTIFACT_VERSION,
    analysisId: input.analysisId,
    ingestionId: input.ingestionId,
    pageCount: input.pageCount,
    pages,
  });
  if (!parsed.success) {
    return { kind: "too_large" };
  }
  return { kind: "ok", artifact: parsed.data, extractedChars };
}

/**
 * PDF text is untrusted data. Normalize only transport noise while retaining
 * words, paragraphs, and page boundaries for later deterministic processing.
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\0/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim();
}

export type TextQualityResult =
  | {
      kind: "sufficient";
      totalNonWhitespaceChars: number;
      meaningfulPageCount: number;
    }
  | {
      kind: "requires_ocr";
      totalNonWhitespaceChars: number;
      meaningfulPageCount: number;
    };

export function assessTextQuality(
  artifact: ExtractionArtifact,
): TextQualityResult {
  let totalNonWhitespaceChars = 0;
  let meaningfulPageCount = 0;

  for (const page of artifact.pages) {
    const pageChars = countNonWhitespaceChars(page.text);
    totalNonWhitespaceChars += pageChars;
    if (pageChars >= MIN_MEANINGFUL_PAGE_CHARS) {
      meaningfulPageCount += 1;
    }
  }

  const requiredMeaningfulPages = Math.min(
    artifact.pageCount,
    Math.max(2, Math.ceil(artifact.pageCount * MIN_MEANINGFUL_PAGE_RATIO)),
  );
  const averageCharsPerPage = totalNonWhitespaceChars / artifact.pageCount;
  const sufficient =
    totalNonWhitespaceChars >= MIN_TOTAL_TEXT_CHARS &&
    averageCharsPerPage >= MIN_AVERAGE_TEXT_CHARS_PER_PAGE &&
    meaningfulPageCount >= requiredMeaningfulPages;

  return sufficient
    ? { kind: "sufficient", totalNonWhitespaceChars, meaningfulPageCount }
    : { kind: "requires_ocr", totalNonWhitespaceChars, meaningfulPageCount };
}

export interface ChunkingOptions {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
  maxChunks?: number;
}

export type ChunkingResult =
  { kind: "ok"; chunks: RulebookChunk[] } | { kind: "too_many_chunks" };

export function chunkExtraction(
  artifact: ExtractionArtifact,
  options: ChunkingOptions = {},
): ChunkingResult {
  const targetChars = options.targetChars ?? TARGET_CHUNK_TEXT_CHARS;
  const maxChars = options.maxChars ?? MAX_CHUNK_TEXT_CHARS;
  const overlapChars = options.overlapChars ?? CHUNK_OVERLAP_CHARS;
  const maxChunks = options.maxChunks ?? MAX_RULEBOOK_CHUNKS;
  const chunks: RulebookChunk[] = [];

  for (const page of artifact.pages) {
    if (page.text.length === 0) {
      continue;
    }
    let start = 0;
    let ordinal = 1;
    while (start < page.text.length) {
      const end = findChunkEnd(page.text, start, targetChars, maxChars);
      const text = page.text.slice(start, end).trim();
      if (text.length > 0) {
        const chunk = RulebookChunkSchema.parse({
          version: RULEBOOK_ARTIFACT_VERSION,
          chunkId: `${artifact.ingestionId}:p${page.pageNumber}:c${ordinal}`,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          text,
        });
        chunks.push(chunk);
        if (chunks.length > maxChunks) {
          return { kind: "too_many_chunks" };
        }
        ordinal += 1;
      }
      if (end >= page.text.length) {
        break;
      }
      const nextStart = Math.max(start + 1, end - overlapChars);
      start = nextStart;
    }
  }

  return { kind: "ok", chunks };
}

function findChunkEnd(
  text: string,
  start: number,
  targetChars: number,
  maxChars: number,
): number {
  const maxEnd = Math.min(text.length, start + maxChars);
  if (maxEnd === text.length) {
    return maxEnd;
  }
  const targetEnd = Math.min(maxEnd, start + targetChars);
  const minimumPreferredEnd = Math.min(
    targetEnd,
    start + Math.floor(targetChars * 0.75),
  );

  for (const separator of ["\n\n", "\n", " "]) {
    const preferred = findPreferredSeparator(
      text,
      separator,
      start,
      minimumPreferredEnd,
      targetEnd,
      maxEnd,
    );
    if (preferred !== null) {
      return preferred;
    }
  }

  return maxEnd;
}

function findPreferredSeparator(
  text: string,
  separator: string,
  start: number,
  minimumEnd: number,
  targetEnd: number,
  maxEnd: number,
): number | null {
  let beforeTarget: number | null = null;
  let cursor = text.indexOf(separator, start + 1);
  while (cursor !== -1 && cursor + separator.length <= maxEnd) {
    const end = cursor + separator.length;
    if (end >= targetEnd) {
      return end;
    }
    if (end >= minimumEnd) {
      beforeTarget = end;
    }
    cursor = text.indexOf(separator, cursor + separator.length);
  }
  return beforeTarget;
}

function countNonWhitespaceChars(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== undefined && !/\s/.test(character)) {
      count += 1;
    }
  }
  return count;
}
