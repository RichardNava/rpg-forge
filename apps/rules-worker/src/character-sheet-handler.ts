import {
  createSheetSession,
  authorizeSheetSession,
  type SheetSession,
} from "@repo/character-sheet-session";
import {
  DraftError,
  SheetDraftCreateRequestV2Schema,
  type CharacterSheetDraftIdentity,
  type CharacterSheetDraftStoreV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { createDraftV2 } from "./features/character-sheets/draft-v2-create.js";
import { mutateDraftV2 } from "./features/character-sheets/draft-v2-mutation.js";
import { rerollDraftV2 } from "./features/character-sheets/draft-v2-reroll.js";
import { confirmDraftV2 } from "./features/character-sheets/draft-v2-confirm.js";
import { undoDraftV2 } from "./features/character-sheets/draft-v2-undo.js";
import { generateFinalCharacterSheet } from "./features/character-sheets/draft-v2-final-generation.js";
import {
  FinalGenerationStartRequestV1Schema,
  FinalGenerationStartResponseV1Schema,
} from "@repo/character-sheet-generation";
import {
  PORTRAIT_MAX_BYTES,
  PortraitAssetRefSchema,
  PortraitGenerateRequestSchema,
  PortraitGenerationPromptSchema,
  PortraitImportUrlRequestSchema,
  validatePortraitImageBytes,
} from "@repo/character-sheet-portraits";
import { importPortraitFromUrl } from "./infrastructure/portrait-url-import.js";
import {
  readCurrentDraftV2,
  type DraftV2Runtime,
} from "./features/character-sheets/draft-v2-runtime.js";
import {
  parseDraftV2ConfirmRequest,
  parseDraftV2MutationRequest,
  parseDraftV2RerollRequest,
  parseDraftV2UndoRequest,
} from "./features/character-sheets/draft-v2-transport.js";
import {
  draftV2CreatedResponse,
  draftV2RerollResponse,
  draftV2SnapshotResponse,
} from "./features/character-sheets/draft-v2-orchestration.js";
import type { ExtractedCharacterNode } from "./features/character-sheets/extraction/extracted-character-structure.js";
import { compileExtractedCharacterStructureV2 } from "./features/character-sheets/extraction/compile-extracted-character-structure-v2.js";
import { ObservationError } from "./infrastructure/sheet-visual-extraction.js";
import {
  parseBearerToken,
  hasJsonContentType,
  readBoundedBytes,
  readBoundedJson,
} from "./http.js";
import { errorResponse, jsonResponse } from "./transport/errors.js";
import {
  CreateSessionRequestSchema,
  SheetSessionCreateResponseSchema,
  SheetSessionViewSchema,
  type SheetSessionView,
} from "./transport/schemas.js";
import type { AppDeps } from "./handler.js";

const SHEET_SESSIONS_PATH = "/v1/character-sheets/sessions";
const SHEET_SESSION_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)$/;
const SHEET_DRAFT_CREATE_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts$/;
const SHEET_DRAFT_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts\/([^/]+)$/;
const SHEET_DRAFT_REROLL_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts\/([^/]+)\/reroll$/;
const SHEET_DRAFT_CONFIRM_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts\/([^/]+)\/confirm$/;
const SHEET_DRAFT_UNDO_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts\/([^/]+)\/undo$/;
const SHEET_DRAFT_GENERATE_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/drafts\/([^/]+)\/generate$/;
const SHEET_RUN_PDF_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/runs\/([^/]+)\/pdf$/;
const SHEET_PORTRAIT_UPLOAD_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/portraits\/upload$/;
const SHEET_PORTRAIT_IMPORT_URL_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/portraits\/import-url$/;
const SHEET_PORTRAIT_GENERATE_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/portraits\/generate$/;
const SHEET_PORTRAIT_PREVIEW_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/portraits\/([^/]+)$/;
const SHEET_DOCUMENT_EXTRACTION_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/extraction$/;
const PORTRAIT_UPLOAD_MAX_REQUEST_BYTES = 8 * 1024 * 1024 + 64 * 1024;
const SHEET_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
const SHEET_DOCUMENT_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const SHEET_DOCUMENT_MAX_REQUEST_BYTES =
  16 * 1024 * 1024 + SHEET_DOCUMENT_MULTIPART_OVERHEAD_BYTES;
const SHEET_DOCUMENT_MAX_IMAGE_PIXELS = 40_000_000;
const SHEET_VISUAL_PAGE_MAX_BYTES = 4 * 1024 * 1024;
const SHEET_DOCUMENT_MAX_PDF_PAGES = 64;
const SHEET_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

function toPublicSheetSession(session: SheetSession): SheetSessionView {
  return {
    sessionId: session.sessionId,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
  };
}

async function authorizeSheetSessionFromRequest(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<
  { kind: "ok"; sessionId: string } | { kind: "response"; response: Response }
> {
  const bearer = parseBearerToken(request);
  if (!bearer.ok) {
    return {
      kind: "response",
      response: errorResponse(
        "INVALID_REQUEST",
        "Missing or malformed Authorization header.",
      ),
    };
  }
  const authorization = await authorizeSheetSession(sessionId, bearer.token, {
    crypto: deps.crypto,
    clock: deps.clock,
    repository: deps.sheetSessionRepository,
  });
  if (authorization.kind === "expired") {
    return {
      kind: "response",
      response: errorResponse("SHEET_SESSION_EXPIRED"),
    };
  }
  if (authorization.kind !== "ok") {
    return {
      kind: "response",
      response: errorResponse("SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED"),
    };
  }
  return { kind: "ok", sessionId: authorization.session.sessionId };
}

function draftStorageUnavailable(): Response {
  return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
}

export async function handleCharacterSheetRequest(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  if (method === "POST" && path === SHEET_SESSIONS_PATH) {
    return handleCreateSheetSession(request, deps);
  }

  const sessionMatch = SHEET_SESSION_PATH_PATTERN.exec(path);
  if (sessionMatch !== null) {
    const sessionId = sessionMatch[1] ?? "";
    if (method === "GET") {
      return handleGetSheetSession(sessionId, request, deps);
    }
  }

  const extractionMatch = SHEET_DOCUMENT_EXTRACTION_PATH_PATTERN.exec(path);
  if (extractionMatch !== null && method === "POST") {
    return handleExtractSheetDocument(extractionMatch[1] ?? "", request, deps);
  }

  const draftRerollMatch = SHEET_DRAFT_REROLL_PATH_PATTERN.exec(path);
  if (draftRerollMatch !== null) {
    const sessionId = draftRerollMatch[1] ?? "";
    const draftId = draftRerollMatch[2] ?? "";
    if (method === "POST") {
      return handleRerollDraft(sessionId, draftId, request, deps);
    }
  }

  const draftConfirmMatch = SHEET_DRAFT_CONFIRM_PATH_PATTERN.exec(path);
  if (draftConfirmMatch !== null) {
    const sessionId = draftConfirmMatch[1] ?? "";
    const draftId = draftConfirmMatch[2] ?? "";
    if (method === "POST") {
      return handleConfirmDraft(sessionId, draftId, request, deps);
    }
  }

  const draftUndoMatch = SHEET_DRAFT_UNDO_PATH_PATTERN.exec(path);
  if (draftUndoMatch !== null) {
    const sessionId = draftUndoMatch[1] ?? "";
    const draftId = draftUndoMatch[2] ?? "";
    if (method === "POST") {
      return handleUndoDraft(sessionId, draftId, request, deps);
    }
  }

  const draftGenerateMatch = SHEET_DRAFT_GENERATE_PATH_PATTERN.exec(path);
  if (draftGenerateMatch !== null) {
    const sessionId = draftGenerateMatch[1] ?? "";
    const draftId = draftGenerateMatch[2] ?? "";
    if (method === "POST") {
      return handleGenerateFinal(sessionId, draftId, request, deps);
    }
  }

  const runPdfMatch = SHEET_RUN_PDF_PATH_PATTERN.exec(path);
  if (runPdfMatch !== null) {
    const sessionId = runPdfMatch[1] ?? "";
    const runId = runPdfMatch[2] ?? "";
    if (method === "GET") {
      return handleGetFinalPdf(sessionId, runId, request, deps);
    }
  }

  const portraitUploadMatch = SHEET_PORTRAIT_UPLOAD_PATH_PATTERN.exec(path);
  if (portraitUploadMatch !== null && method === "POST") {
    return handleUploadPortrait(portraitUploadMatch[1] ?? "", request, deps);
  }

  const portraitImportMatch = SHEET_PORTRAIT_IMPORT_URL_PATH_PATTERN.exec(path);
  if (portraitImportMatch !== null && method === "POST") {
    return handleImportPortraitUrl(portraitImportMatch[1] ?? "", request, deps);
  }

  const portraitGenerateMatch = SHEET_PORTRAIT_GENERATE_PATH_PATTERN.exec(path);
  if (portraitGenerateMatch !== null && method === "POST") {
    return handleGeneratePortrait(portraitGenerateMatch[1] ?? "", request, deps);
  }

  const portraitPreviewMatch = SHEET_PORTRAIT_PREVIEW_PATH_PATTERN.exec(path);
  if (portraitPreviewMatch !== null && method === "GET") {
    return handleGetPortraitPreview(
      portraitPreviewMatch[1] ?? "",
      portraitPreviewMatch[2] ?? "",
      request,
      deps,
    );
  }

  const draftMatch = SHEET_DRAFT_PATH_PATTERN.exec(path);
  if (draftMatch !== null) {
    const sessionId = draftMatch[1] ?? "";
    const draftId = draftMatch[2] ?? "";
    if (method === "GET") {
      return handleGetDraft(sessionId, draftId, url, request, deps);
    }
    if (method === "PATCH") {
      return handleMutateDraft(sessionId, draftId, request, deps);
    }
  }

  const draftCreateMatch = SHEET_DRAFT_CREATE_PATH_PATTERN.exec(path);
  if (draftCreateMatch !== null) {
    const sessionId = draftCreateMatch[1] ?? "";
    if (method === "POST") {
      return handleCreateDraft(sessionId, request, deps);
    }
  }

  return errorResponse("INVALID_REQUEST", "Route not found.", 404);
}

async function handleExtractSheetDocument(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return errorResponse("SHEET_DOCUMENT_INVALID_REQUEST");
  }
  // Reject before multipart parsing can allocate an unbounded upload.
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(
    `sheet-document-extraction:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }
  const requestBytes = await readBoundedBytes(
    request,
    SHEET_DOCUMENT_MAX_REQUEST_BYTES,
  );
  if (requestBytes === null) {
    return errorResponse("SHEET_DOCUMENT_TOO_LARGE");
  }

  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: requestBytes,
    }).formData();
  } catch {
    return errorResponse("SHEET_DOCUMENT_INVALID_REQUEST");
  }
  const documents = form.getAll("document");
  const document = documents.length === 1 ? documents[0] : null;
  if (!(document instanceof File)) {
    return errorResponse("SHEET_DOCUMENT_INVALID_REQUEST");
  }
  const pageValues = form.getAll("page");
  const pages = pageValues.filter(
    (value): value is File => value instanceof File,
  );
  if (pages.length !== pageValues.length || pages.length > 3) {
    return errorResponse("SHEET_DOCUMENT_INVALID_REQUEST");
  }
  if (!SHEET_DOCUMENT_MIME_TYPES.has(document.type)) {
    return errorResponse("SHEET_DOCUMENT_INVALID_TYPE");
  }
  if (document.size === 0 || document.size > SHEET_DOCUMENT_MAX_BYTES) {
    return errorResponse("SHEET_DOCUMENT_TOO_LARGE");
  }
  if (!(await hasValidDocumentContent(document))) {
    return errorResponse("SHEET_DOCUMENT_INVALID_CONTENT");
  }
  for (const page of pages) {
    if (page.type !== "image/jpeg") {
      return errorResponse("SHEET_DOCUMENT_INVALID_TYPE");
    }
    if (page.size === 0 || page.size > SHEET_VISUAL_PAGE_MAX_BYTES) {
      return errorResponse("SHEET_DOCUMENT_TOO_LARGE");
    }
    if (!(await hasValidDocumentContent(page))) {
      return errorResponse("SHEET_DOCUMENT_INVALID_CONTENT");
    }
  }
  if (pages.length > 0 && deps.sheetVisualExtraction !== undefined) {
    try {
      const observed = await deps.sheetVisualExtraction.extract({ pages });
      if (deps.debugSheetDrafts) {
        console.info("[character-sheet] observed structure", {
          pageCount: observed.document.pageCount,
          rootNodes: observed.nodes.length,
          observedFields: countObservedFields(observed.nodes),
        });
      }
      const draft = compileExtractedCharacterStructureV2({
        structure: observed,
        sessionId: auth.sessionId,
        sourceSheetId: deriveDocumentSourceId(document.name),
      });
      console.info("character-sheet draft compiled", {
        compiledSectionCount: draft.sections.length,
        compiledFieldCount: draft.fields.length,
        rootFieldCount: countRootFieldsV2(draft),
      });
      traceSheetDraft(deps, "extraction response", draft);
      return jsonResponse(200, draft);
    } catch (error) {
      // Provider diagnostics only; never log document bytes or model output.
      console.warn("character-sheet visual extraction failed", {
        error:
          error instanceof Error && error.message !== ""
            ? error.message.slice(0, 256)
            : "unknown",
      });
      return errorResponse(
        error instanceof ObservationError && error.stage !== "timeout"
          ? "SHEET_DOCUMENT_EXTRACTION_FAILED"
          : "SHEET_DOCUMENT_EXTRACTION_UNAVAILABLE",
      );
    }
  }
  return errorResponse("SHEET_DOCUMENT_EXTRACTION_UNAVAILABLE");
}

function countObservedFields(nodes: readonly ExtractedCharacterNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "field" ? 1 : countObservedFields(node.children)),
    0,
  );
}

function countRootFieldsV2(draft: CharacterSheetDraftV2): number {
  return draft.structure.filter(
    (placement) => placement.kind === "field" && placement.parentKey === null,
  ).length;
}

/** Debugging deliberately records only aggregate draft metadata, never content. */
function traceSheetDraft(
  deps: AppDeps,
  title: string,
  draft: {
    readonly fields: ReadonlyArray<unknown>;
    readonly sections?: ReadonlyArray<unknown> | null | undefined;
    readonly values: Readonly<Record<string, unknown>>;
    readonly confirmed: boolean;
  },
): void {
  if (!deps.debugSheetDrafts) return;
  console.info(`[character-sheet] ${title}`, {
    fieldCount: draft.fields.length,
    sectionCount: draft.sections?.length ?? 0,
    valueCount: Object.keys(draft.values).length,
    confirmed: draft.confirmed,
  });
}

async function hasValidDocumentContent(document: File): Promise<boolean> {
  const bytes = new Uint8Array(await document.arrayBuffer());
  if (document.type === "application/pdf") {
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      return false;
    }
    const pdf = new TextDecoder("latin1").decode(bytes);
    return (
      (pdf.match(/\/Type\s*\/Page\b/g)?.length ?? 0) <=
      SHEET_DOCUMENT_MAX_PDF_PAGES
    );
  }
  if (document.type === "image/png") {
    if (
      !startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) ||
      bytes.length < 24
    ) {
      return false;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return pixelsAreWithinLimit(view.getUint32(16), view.getUint32(20));
  }
  return isValidJpeg(bytes);
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function pixelsAreWithinLimit(width: number, height: number): boolean {
  return (
    width > 0 && height > 0 && width * height <= SHEET_DOCUMENT_MAX_IMAGE_PIXELS
  );
}

function isValidJpeg(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return false;
  }
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return false;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 7 || offset + length > bytes.length) return false;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      return pixelsAreWithinLimit(width, height);
    }
    offset += length;
  }
  return false;
}

function deriveDocumentSourceId(fileName: string): string {
  const source = fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 128);
  return source === "" ? "uploaded-sheet" : source;
}

async function handleCreateSheetSession(
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }

  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "Request body is invalid.");
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(
    `sheet-session-create:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }

  const verification = await deps.humanVerifier.verify(
    parsed.data.turnstileToken,
    { clientIp },
  );
  if (verification.kind === "unavailable") {
    return errorResponse("HUMAN_VERIFICATION_REQUIRED");
  }
  if (verification.kind === "failed") {
    return errorResponse("HUMAN_VERIFICATION_FAILED");
  }

  const created = await createSheetSession({
    crypto: deps.crypto,
    clock: deps.clock,
    repository: deps.sheetSessionRepository,
  });

  return jsonResponse(
    201,
    SheetSessionCreateResponseSchema.parse({
      sessionId: created.sessionId,
      accessToken: created.accessToken,
      expiresAt: created.expiresAt.toISOString(),
    }),
  );
}

async function handleGetSheetSession(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  const session = await deps.sheetSessionRepository.findById(auth.sessionId);
  if (session === null) {
    return errorResponse("SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED");
  }
  return jsonResponse(
    200,
    SheetSessionViewSchema.parse(toPublicSheetSession(session)),
  );
}

async function handleCreateDraft(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }

  const parsed = SheetDraftCreateRequestV2Schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("SHEET_DRAFT_INVALID");
  }

  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }

  let created;
  try {
    created = await createDraftV2(
      { heads: runtime.heads, store: runtime.store },
      auth.sessionId,
      parsed.data,
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (created.kind === "already_exists") {
    return errorResponse("SHEET_DRAFT_ALREADY_EXISTS");
  }

  traceSheetDraft(deps, "draft create response", created.draft);
  return draftV2CreatedResponse(created.draft);
}

async function handleGetDraft(
  sessionId: string,
  draftId: string,
  url: URL,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  const identity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };
  const versionParam = url.searchParams.get("version");
  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }

  let version: number | null = null;
  if (versionParam !== null) {
    if (!/^\d+$/.test(versionParam)) {
      return errorResponse(
        "SHEET_DRAFT_INVALID",
        "The version query parameter must be an integer.",
      );
    }
    version = Number(versionParam);
  }

  // If a specific version is requested, serve it directly (no head-read needed).
  if (version !== null) {
    const read = await readDraftSnapshotV2(runtime.store, identity, version);
    if (read.kind === "error") {
      return read.response;
    }
    if (read.draft === null) {
      return errorResponse("SHEET_DRAFT_NOT_FOUND");
    }
    traceSheetDraft(deps, "draft version response", read.draft);
    return draftV2SnapshotResponse(read.draft);
  }

  // No version requested: resolve through the draft head.
  let current;
  try {
    current = await readCurrentDraftV2(runtime, identity);
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (current === null || current.draft === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }
  traceSheetDraft(deps, "draft current response", current.draft);
  return draftV2SnapshotResponse(current.draft);
}

async function handleMutateDraft(
  sessionId: string,
  draftId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }

  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }

  const parsed = parseDraftV2MutationRequest(body);
  if (parsed.kind === "invalid") {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain an expectedVersion and a mutation.",
    );
  }

  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  let mutated;
  try {
    mutated = await mutateDraftV2(
      runtime,
      draftIdentity,
      parsed.value.expectedVersion,
      parsed.value.mutation,
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (mutated === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  // Read the updated head to get undo metadata for the client
  const head = await deps.sheetDraftHeadRepository.getHead(draftIdentity);
  const undoHeaders: Record<string, string> = {};
  if (head) {
    if (head.undoSourceVersion !== null && !head.undoConsumed) {
      undoHeaders["X-Undo-Available"] = "true";
      undoHeaders["X-Undo-Source-Version"] = String(head.undoSourceVersion);
    } else {
      undoHeaders["X-Undo-Available"] = "false";
    }
  }

  traceSheetDraft(deps, "draft mutation response", mutated);
  return draftV2SnapshotResponse(mutated, undoHeaders);
}

async function handleRerollDraft(
  sessionId: string,
  draftId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }

  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }

  const parsed = parseDraftV2RerollRequest(body);
  if (parsed.kind === "invalid") {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain an expectedVersion and a seed string.",
    );
  }

  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  let rerolled;
  try {
    rerolled = await rerollDraftV2(
      runtime,
      draftIdentity,
      parsed.value.expectedVersion,
      parsed.value.seed,
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (rerolled === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  traceSheetDraft(deps, "draft reroll response", rerolled.draft);
  return draftV2RerollResponse(rerolled);
}

async function handleConfirmDraft(
  sessionId: string,
  draftId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }

  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }
  const parsed = parseDraftV2ConfirmRequest(body);
  if (parsed.kind === "invalid") {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain an expectedVersion.",
    );
  }

  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  let confirmed;
  try {
    confirmed = await confirmDraftV2(
      runtime,
      draftIdentity,
      parsed.value.expectedVersion,
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (confirmed === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  traceSheetDraft(deps, "draft confirmation response", confirmed);
  return draftV2SnapshotResponse(confirmed);
}

async function handleUndoDraft(
  sessionId: string,
  draftId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }

  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }
  const parsed = parseDraftV2UndoRequest(body);
  if (parsed.kind === "invalid") {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain an expectedVersion.",
    );
  }

  const runtime = v2DraftRuntime(deps);
  if (runtime === null) {
    return draftStorageUnavailable();
  }
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  let undone;
  try {
    undone = await undoDraftV2(
      runtime,
      draftIdentity,
      parsed.value.expectedVersion,
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }
  if (undone === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  traceSheetDraft(deps, "draft undo response", undone);
  return draftV2SnapshotResponse(undone);
}

async function handleGenerateFinal(
  sessionId: string,
  draftId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }

  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body is malformed or too large.",
    );
  }
  const parsed = FinalGenerationStartRequestV1Schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain expectedVersion, options and seed.",
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(
    `sheet-final-generation:${clientIp}`,
  );
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }

  const runtime = v2DraftRuntime(deps);
  if (
    runtime === null ||
    deps.sheetRunRepository === undefined ||
    deps.sheetArtifactStore === undefined
  ) {
    return draftStorageUnavailable();
  }

  let outcome;
  try {
    outcome = await generateFinalCharacterSheet(
      {
        runtime,
        runs: deps.sheetRunRepository,
        artifacts: deps.sheetArtifactStore,
        sessions: deps.sheetSessionRepository,
        ...(deps.finalPresentationPort === undefined
          ? {}
          : { presentation: deps.finalPresentationPort }),
        ...(deps.portraitAssetStore === undefined
          ? {}
          : { portraits: deps.portraitAssetStore }),
        clock: deps.clock,
        crypto: deps.crypto,
      },
      {
        identity: { sessionId: auth.sessionId, draftId },
        expectedVersion: parsed.data.expectedVersion,
        options: parsed.data.options,
        seed: parsed.data.seed,
      },
    );
  } catch (error) {
    return draftErrorToResponse(error);
  }

  switch (outcome.kind) {
    case "ok":
      return jsonResponse(
        200,
        FinalGenerationStartResponseV1Schema.parse({
          schemaVersion: "1",
          runId: outcome.run.runId,
          status: "READY",
          draftId: outcome.run.draftId,
          draftVersion: outcome.run.draftVersion,
        }),
      );
    case "not_found":
      return errorResponse("SHEET_DRAFT_NOT_FOUND");
    case "conflict":
      return errorResponse("SHEET_DRAFT_VERSION_CONFLICT");
    case "invalid":
      if (outcome.code === "unsupported_style") {
        return errorResponse("SHEET_FINAL_STYLE_UNSUPPORTED", outcome.message);
      }
      return errorResponse("SHEET_FINAL_GENERATION_INVALID", outcome.message);
    case "unavailable":
      return errorResponse("SHEET_FINAL_GENERATION_UNAVAILABLE", outcome.message);
    case "failed":
      return errorResponse("SHEET_FINAL_GENERATION_FAILED", outcome.message);
  }
}

async function handleUploadPortrait(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (deps.portraitAssetStore === undefined) {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(`sheet-portrait-upload:${clientIp}`);
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }
  const requestBytes = await readBoundedBytes(request, PORTRAIT_UPLOAD_MAX_REQUEST_BYTES);
  if (requestBytes === null) {
    return errorResponse("SHEET_PORTRAIT_TOO_LARGE");
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: requestBytes,
    }).formData();
  } catch {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  const images = form.getAll("image");
  const image = images.length === 1 ? images[0] : null;
  if (!(image instanceof File)) {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  if (image.size === 0 || image.size > PORTRAIT_MAX_BYTES) {
    return errorResponse("SHEET_PORTRAIT_TOO_LARGE");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await image.arrayBuffer());
  } catch {
    return errorResponse("SHEET_PORTRAIT_INVALID_CONTENT");
  }
  const validated = validatePortraitImageBytes(bytes);
  if (!validated.valid || validated.mimeType === null) {
    if (validated.code === "unsupported_type") {
      return errorResponse("SHEET_PORTRAIT_INVALID_TYPE");
    }
    if (validated.code === "too_large" || validated.code === "too_many_pixels") {
      return errorResponse("SHEET_PORTRAIT_TOO_LARGE");
    }
    return errorResponse("SHEET_PORTRAIT_INVALID_CONTENT");
  }
  const assetId = deps.crypto.uuid();
  try {
    await deps.portraitAssetStore.putAsset({
      sessionId: auth.sessionId,
      assetId,
      source: "upload",
      mimeType: validated.mimeType,
      sizeBytes: bytes.length,
      width: validated.width,
      height: validated.height,
      imageBytes: bytes,
    });
  } catch {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  return jsonResponse(
    201,
    PortraitAssetRefSchema.parse({
      schemaVersion: "1",
      assetId,
      source: "upload",
      mimeType: validated.mimeType,
    }),
  );
}

async function handleImportPortraitUrl(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (deps.portraitAssetStore === undefined) {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse("INVALID_REQUEST", "Request body is malformed or too large.");
  }
  const parsed = PortraitImportUrlRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(`sheet-portrait-url:${clientIp}`);
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }
  const imported = await importPortraitFromUrl(parsed.data.url);
  if (imported.kind === "rejected") {
    switch (imported.code) {
      case "insecure_scheme":
      case "invalid_url":
      case "forbidden_host":
      case "too_many_redirects":
        return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST", imported.message);
      case "too_large":
        return errorResponse("SHEET_PORTRAIT_TOO_LARGE", imported.message);
      case "fetch_failed":
        return errorResponse("SHEET_PORTRAIT_UNAVAILABLE", imported.message);
      case "invalid_content":
        return errorResponse("SHEET_PORTRAIT_INVALID_CONTENT", imported.message);
    }
  }
  const validated = validatePortraitImageBytes(imported.bytes);
  if (!validated.valid || validated.mimeType === null) {
    return errorResponse("SHEET_PORTRAIT_INVALID_CONTENT");
  }
  const assetId = deps.crypto.uuid();
  try {
    await deps.portraitAssetStore.putAsset({
      sessionId: auth.sessionId,
      assetId,
      source: "url",
      mimeType: validated.mimeType,
      sizeBytes: imported.bytes.length,
      width: validated.width,
      height: validated.height,
      imageBytes: imported.bytes,
    });
  } catch {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  return jsonResponse(
    201,
    PortraitAssetRefSchema.parse({
      schemaVersion: "1",
      assetId,
      source: "url",
      mimeType: validated.mimeType,
    }),
  );
}

async function handleGeneratePortrait(
  sessionId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (deps.portraitAssetStore === undefined) {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  if (!hasJsonContentType(request)) {
    return errorResponse("INVALID_REQUEST", "Expected application/json.");
  }
  const body = await readBoundedJson(request);
  if (body === null) {
    return errorResponse("INVALID_REQUEST", "Request body is malformed or too large.");
  }
  const parsed = PortraitGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await deps.rateLimiter.consume(`sheet-portrait-generate:${clientIp}`);
  if (rateLimit.kind === "unavailable") {
    return errorResponse("RATE_LIMIT_UNAVAILABLE");
  }
  if (rateLimit.kind === "denied") {
    return errorResponse("RATE_LIMITED");
  }
  if (deps.portraitGenerationPort === undefined) {
    return errorResponse("SHEET_PORTRAIT_UNAVAILABLE");
  }
  const promptParsed = PortraitGenerationPromptSchema.safeParse(parsed.data.prompt);
  if (!promptParsed.success) {
    return errorResponse("SHEET_PORTRAIT_INVALID_REQUEST");
  }
  let generated;
  try {
    generated = await deps.portraitGenerationPort.generate({
      prompt: promptParsed.data,
      styleContext: null,
    });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "INVALID_OUTPUT"
    ) {
      return errorResponse("SHEET_PORTRAIT_GENERATION_FAILED");
    }
    return errorResponse("SHEET_PORTRAIT_UNAVAILABLE");
  }
  const validated = validatePortraitImageBytes(generated.bytes);
  if (!validated.valid || validated.mimeType === null || validated.mimeType !== generated.mimeType) {
    return errorResponse("SHEET_PORTRAIT_GENERATION_FAILED");
  }
  const assetId = deps.crypto.uuid();
  try {
    await deps.portraitAssetStore.putAsset({
      sessionId: auth.sessionId,
      assetId,
      source: "ai",
      mimeType: validated.mimeType,
      sizeBytes: generated.bytes.length,
      width: validated.width,
      height: validated.height,
      imageBytes: generated.bytes,
    });
  } catch {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  return jsonResponse(
    201,
    PortraitAssetRefSchema.parse({
      schemaVersion: "1",
      assetId,
      source: "ai",
      mimeType: validated.mimeType,
    }),
  );
}

async function handleGetPortraitPreview(
  sessionId: string,
  assetId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (deps.portraitAssetStore === undefined) {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  let record;
  try {
    record = await deps.portraitAssetStore.getAsset({
      sessionId: auth.sessionId,
      assetId,
    });
  } catch {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  if (record === null) {
    return errorResponse("SHEET_PORTRAIT_NOT_FOUND");
  }
  const body = new Uint8Array(record.imageBytes.length);
  body.set(record.imageBytes);
  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": record.metadata.mimeType,
      "cache-control": "no-store",
    },
  });
}

function safePdfFilename(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned === "" ? "character-sheet" : cleaned;
}

async function handleGetFinalPdf(
  sessionId: string,
  runId: string,
  request: Request,
  deps: AppDeps,
): Promise<Response> {
  const auth = await authorizeSheetSessionFromRequest(sessionId, request, deps);
  if (auth.kind === "response") {
    return auth.response;
  }
  if (deps.sheetRunRepository === undefined || deps.sheetArtifactStore === undefined) {
    return draftStorageUnavailable();
  }
  const run = await deps.sheetRunRepository.getById(runId);
  if (run === null || run.sessionId !== auth.sessionId) {
    return errorResponse("SHEET_FINAL_RUN_NOT_FOUND");
  }
  if (run.status !== "READY") {
    return errorResponse("SHEET_FINAL_RUN_NOT_READY");
  }
  let pdfBytes: Uint8Array | null;
  try {
    pdfBytes = await deps.sheetArtifactStore.getPdfBytes({
      sessionId: auth.sessionId,
      runId,
    });
  } catch {
    return errorResponse("SHEET_DRAFT_STORAGE_UNAVAILABLE");
  }
  if (pdfBytes === null) {
    return errorResponse("SHEET_FINAL_RUN_NOT_FOUND");
  }
  const filename = safePdfFilename(run.draftId ?? "character-sheet");
  // Copy into a fresh ArrayBuffer so the Response body is a clean ArrayBuffer.
  const body = new Uint8Array(pdfBytes.length);
  body.set(pdfBytes);
  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}

type DraftV2ReadOutcome =
  | { kind: "ok"; draft: CharacterSheetDraftV2 | null }
  | { kind: "error"; response: Response };

/**
 * Builds the route-independent V2 runtime from live dependencies, or `null`
 * when the V2 store binding is unavailable. Callers fail closed with the
 * existing storage-unavailable response.
 */
function v2DraftRuntime(deps: AppDeps): DraftV2Runtime | null {
  if (deps.sheetDraftStoreV2 === undefined) {
    return null;
  }
  return {
    heads: deps.sheetDraftHeadRepository,
    store: deps.sheetDraftStoreV2,
    clock: deps.clock,
    crypto: deps.crypto,
  };
}

/**
 * Reads one immutable snapshot through the shared `DraftError` translation.
 *
 * A missing snapshot is `null`, never an error: absence is a routing decision
 * (`SHEET_DRAFT_NOT_FOUND`), not a storage failure.
 */
async function readDraftSnapshotV2(
  store: CharacterSheetDraftStoreV2,
  identity: CharacterSheetDraftIdentity,
  version: number,
): Promise<DraftV2ReadOutcome> {
  try {
    return {
      kind: "ok",
      draft: await store.getDraftVersion(identity, version),
    };
  } catch (error) {
    return { kind: "error", response: draftErrorToResponse(error) };
  }
}

/**
 * Translates a thrown `DraftError` into its HTTP response.
 *
 * 4E3A — repaired additively. Two arms were missing:
 *
 * - `version_conflict` previously fell through to the default arm and became
 *   `SHEET_DRAFT_MUTATION_INVALID` (422). V2 throws this code from its
 *   `expectedVersion` preconditions, so a stale client would have received a 422
 *   that invites a blind retry loop against a version it can never reconcile.
 *   It now maps to `SHEET_DRAFT_VERSION_CONFLICT` (409).
 * - `corrupt_draft` has been declared in `ErrorCodeSchema` since it existed, but
 *   no arm ever produced it, so a corrupt stored snapshot surfaced as the default
 *   422 mutation error. It now maps to `SHEET_DRAFT_CORRUPT` (500).
 *
 * `storage_unavailable` is added in the same change because making the store-read
 * paths below reachable is what exposes it: without this arm, a transient R2 read
 * failure on those newly-translated paths would report 422 instead of 503.
 *
 * 4E5 completes the taxonomy for the V2 live runtime: `invalid_draft` and
 * `invalid_draft_identity` map to `SHEET_DRAFT_INVALID` (400),
 * `invalid_mutation` maps explicitly to `SHEET_DRAFT_MUTATION_INVALID` (422),
 * `cleanup_failed` maps to storage-unavailable (503), and
 * `projection_invalid` / `writeback_invalid` map to `INTERNAL_ERROR` (500).
 *
 * No existing arm was removed or re-statused.
 */
function draftErrorToResponse(error: unknown): Response {
  if (error instanceof DraftError) {
    switch (error.code) {
      case "field_read_locked":
        return errorResponse("SHEET_DRAFT_FIELD_READ_LOCKED", error.message);
      case "surface_out_of_bounds":
        return errorResponse(
          "SHEET_DRAFT_SURFACE_OUT_OF_BOUNDS",
          error.message,
        );
      case "draft_confirmed":
        return errorResponse("SHEET_DRAFT_CONFIRMED");
      case "draft_inflight":
        return errorResponse("SHEET_DRAFT_INFLIGHT");
      case "draft_session_mismatch":
      case "session_expired":
        return errorResponse("SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED");
      case "corrupt_draft":
        return errorResponse("SHEET_DRAFT_CORRUPT", error.message);
      case "version_conflict":
        return errorResponse("SHEET_DRAFT_VERSION_CONFLICT", error.message);
      case "storage_unavailable":
        return draftStorageUnavailable();
      case "invalid_draft":
      case "invalid_draft_identity":
        return errorResponse("SHEET_DRAFT_INVALID", error.message);
      case "invalid_mutation":
        return errorResponse("SHEET_DRAFT_MUTATION_INVALID", error.message);
      case "undo_not_available":
        return errorResponse("SHEET_DRAFT_UNDO_NOT_AVAILABLE", error.message);
      case "undo_already_consumed":
        return errorResponse(
          "SHEET_DRAFT_UNDO_ALREADY_CONSUMED",
          error.message,
        );
      case "undo_source_missing":
        return errorResponse("SHEET_DRAFT_UNDO_SOURCE_MISSING", error.message);
      case "cleanup_failed":
        return draftStorageUnavailable();
      case "projection_invalid":
      case "writeback_invalid":
        return errorResponse("INTERNAL_ERROR", error.message);
    }
    return errorResponse("SHEET_DRAFT_MUTATION_INVALID", error.message);
  }
  return errorResponse("SHEET_DRAFT_MUTATION_INVALID");
}
