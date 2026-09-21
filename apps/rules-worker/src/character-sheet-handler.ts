import {
  createSheetSession,
  authorizeSheetSession,
  type DraftHeadIdentity,
  type SheetSession,
} from "@repo/character-sheet-session";
import {
  applyDraftMutation,
  rerollLockedDraftValues,
  finalizeDraft,
  bumpDraftVersion,
  DraftError,
  validateDraft,
  type CharacterSheetDraft,
  type CharacterSheetDraftIdentity,
} from "@repo/character-sheet-draft";
import type { ExtractedCharacterNode } from "./features/character-sheets/extraction/extracted-character-structure.js";
import { compileExtractedCharacterStructure } from "./features/character-sheets/extraction/compile-extracted-character-structure.js";
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
  SheetDraftRerollRequestSchema,
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
const SHEET_DOCUMENT_EXTRACTION_PATH_PATTERN =
  /^\/v1\/character-sheets\/sessions\/([^/]+)\/extraction$/;
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
      const draft = compileExtractedCharacterStructure({
        structure: observed,
        sessionId: auth.sessionId,
        sourceSheetId: deriveDocumentSourceId(document.name),
      });
      console.info("character-sheet draft compiled", {
        compiledSectionCount: draft.sections?.length ?? 0,
        compiledFieldCount: draft.fields.length,
        ungroupedFieldCount: countUngroupedFields(draft),
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

function countUngroupedFields(draft: CharacterSheetDraft): number {
  const assigned = new Set(
    draft.sections?.flatMap((section) => section.fieldKeys) ?? [],
  );
  return draft.fields.filter((field) => !assigned.has(field.key)).length;
}

/** Debugging deliberately records only aggregate draft metadata, never content. */
function traceSheetDraft(
  deps: AppDeps,
  title: string,
  draft: CharacterSheetDraft,
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

  let snapshot: CharacterSheetDraft;
  try {
    snapshot = validateDraft(body);
  } catch {
    return errorResponse("SHEET_DRAFT_INVALID");
  }

  if (snapshot.sessionId !== auth.sessionId) {
    return errorResponse(
      "SHEET_DRAFT_INVALID",
      "The session id does not match the draft session id.",
    );
  }

  if (snapshot.version !== 1) {
    return errorResponse(
      "SHEET_DRAFT_INVALID",
      "A new draft must start at version 1.",
    );
  }

  const headIdentity: DraftHeadIdentity = {
    sessionId: auth.sessionId,
    draftId: snapshot.draftId,
  };

  if (deps.sheetDraftStore === undefined) {
    return draftStorageUnavailable();
  }

  // An existing head means this draft already exists. The client reconciles
  // with a GET; we never overwrite or delete committed R2 snapshots on a retry.
  const existingHead =
    await deps.sheetDraftHeadRepository.getHead(headIdentity);
  if (existingHead !== null) {
    return errorResponse("SHEET_DRAFT_ALREADY_EXISTS");
  }

  // R2 write first, then the atomic D1 head create owns the draft. Only in a
  // concurrent duplicate-create race does the create lose after a successful
  // R2 write; the orphaned snapshot is left to the session sweep because the
  // version slot may already hold the winning writer's committed data.
  try {
    await deps.sheetDraftStore.putDraft(snapshot);
  } catch {
    return draftStorageUnavailable();
  }

  const headCreated = await deps.sheetDraftHeadRepository.create(headIdentity);
  if (headCreated.kind === "already_exists") {
    return errorResponse("SHEET_DRAFT_ALREADY_EXISTS");
  }

  traceSheetDraft(deps, "draft create response", snapshot);
  return jsonResponse(201, snapshot);
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
  if (deps.sheetDraftStore === undefined) {
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
    const draft = await deps.sheetDraftStore.getDraftVersion(identity, version);
    if (draft === null) {
      return errorResponse("SHEET_DRAFT_NOT_FOUND");
    }
    traceSheetDraft(deps, "draft version response", draft);
    return jsonResponse(200, draft);
  }

  // No version requested: resolve through the draft head.
  const head = await deps.sheetDraftHeadRepository.getStable({
    sessionId: auth.sessionId,
    draftId,
  });
  if (head === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  const draft = await deps.sheetDraftStore.getDraftVersion(
    identity,
    head.currentVersion,
  );
  if (draft === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }
  traceSheetDraft(deps, "draft current response", draft);
  return jsonResponse(200, draft);
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

  if (deps.sheetDraftStore === undefined) {
    return draftStorageUnavailable();
  }

  const headIdentity: DraftHeadIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  const head = await deps.sheetDraftHeadRepository.getHead(headIdentity);
  if (head === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  const currentDraft = await deps.sheetDraftStore.getDraftVersion(
    draftIdentity,
    head.currentVersion,
  );
  if (currentDraft === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  let mutated: CharacterSheetDraft;
  try {
    mutated = applyDraftMutation(currentDraft, body);
  } catch (error) {
    return draftErrorToResponse(error);
  }

  const nextVersion = bumpDraftVersion(mutated);
  const committed = await claimCommitDraft(
    { headIdentity, head, nextVersion },
    deps,
  );
  if (committed.kind === "error") {
    return committed.response;
  }

  traceSheetDraft(deps, "draft mutation response", committed.draft);
  return jsonResponse(200, committed.draft);
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

  if (deps.sheetDraftStore === undefined) {
    return draftStorageUnavailable();
  }

  const parsedSeed = SheetDraftRerollRequestSchema.safeParse(body);
  if (!parsedSeed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "The request body must contain a seed string.",
    );
  }
  const seed = parsedSeed.data.seed;

  const headIdentity: DraftHeadIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  const head = await deps.sheetDraftHeadRepository.getHead(headIdentity);
  if (head === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  const currentDraft = await deps.sheetDraftStore.getDraftVersion(
    draftIdentity,
    head.currentVersion,
  );
  if (currentDraft === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  const { draft: rerolledDraft, rerolledKeys } = rerollLockedDraftValues(
    currentDraft,
    seed,
  );

  const nextVersion = bumpDraftVersion(rerolledDraft);
  const committed = await claimCommitDraft(
    { headIdentity, head, nextVersion },
    deps,
  );
  if (committed.kind === "error") {
    return committed.response;
  }

  traceSheetDraft(deps, "draft confirmation response", committed.draft);
  return jsonResponse(200, {
    draft: committed.draft,
    rerolledKeys,
  });
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

  if (deps.sheetDraftStore === undefined) {
    return draftStorageUnavailable();
  }

  const headIdentity: DraftHeadIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };
  const draftIdentity: CharacterSheetDraftIdentity = {
    sessionId: auth.sessionId,
    draftId,
  };

  const head = await deps.sheetDraftHeadRepository.getHead(headIdentity);
  if (head === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  const headDraft = await deps.sheetDraftStore.getDraftVersion(
    draftIdentity,
    head.currentVersion,
  );
  if (headDraft === null) {
    return errorResponse("SHEET_DRAFT_NOT_FOUND");
  }

  let confirmedDraft: CharacterSheetDraft;
  try {
    confirmedDraft = finalizeDraft(headDraft);
  } catch (error) {
    return draftErrorToResponse(error);
  }

  const committed = await claimCommitDraft(
    { headIdentity, head, nextVersion: confirmedDraft },
    deps,
  );
  if (committed.kind === "error") {
    return committed.response;
  }

  return jsonResponse(200, {
    draft: committed.draft,
  });
}

type ClaimCommitOutcome =
  | { kind: "ok"; draft: CharacterSheetDraft }
  | { kind: "error"; response: Response };

async function claimCommitDraft(
  input: {
    headIdentity: DraftHeadIdentity;
    head: {
      currentVersion: number;
      pendingVersion: number | null;
      pendingClaimId: string | null;
    };
    nextVersion: CharacterSheetDraft;
  },
  deps: AppDeps,
): Promise<ClaimCommitOutcome> {
  const { headIdentity, nextVersion } = input;
  const { currentVersion, pendingClaimId, pendingVersion } = input.head;

  if (deps.sheetDraftStore === undefined) {
    return { kind: "error", response: draftStorageUnavailable() };
  }

  if (pendingVersion !== null || pendingClaimId !== null) {
    return {
      kind: "error",
      response: errorResponse("SHEET_DRAFT_INFLIGHT"),
    };
  }

  const claimId = deps.crypto.uuid();
  const now = deps.clock.now();
  const claimed = await deps.sheetDraftHeadRepository.claim(
    headIdentity,
    currentVersion,
    claimId,
    now,
  );

  if (claimed.kind === "already_pending") {
    return {
      kind: "error",
      response: errorResponse("SHEET_DRAFT_INFLIGHT"),
    };
  }
  if (claimed.kind === "version_conflict") {
    return {
      kind: "error",
      response: errorResponse("SHEET_DRAFT_VERSION_CONFLICT"),
    };
  }
  if (claimed.kind === "not_found") {
    return {
      kind: "error",
      response: errorResponse("SHEET_DRAFT_NOT_FOUND"),
    };
  }

  try {
    await deps.sheetDraftStore.putDraft(nextVersion);
  } catch {
    try {
      await deps.sheetDraftHeadRepository.release(
        headIdentity,
        claimId,
        claimed.claimedVersion,
        deps.clock.now(),
      );
    } catch {
      // Best-effort compensation; stale-claim recovery covers residual claims.
    }
    return { kind: "error", response: draftStorageUnavailable() };
  }

  const committed = await deps.sheetDraftHeadRepository.commit(
    headIdentity,
    claimId,
    currentVersion,
    deps.clock.now(),
  );

  if (committed.kind === "wrong_claim" || committed.kind === "not_found") {
    // R2 snapshot was written but the D1 commit failed to match ownership.
    // Release our claim so the next writer can proceed.
    try {
      await deps.sheetDraftHeadRepository.release(
        headIdentity,
        claimId,
        claimed.claimedVersion,
        deps.clock.now(),
      );
    } catch {
      // Best-effort compensation.
    }
    return {
      kind: "error",
      response: errorResponse(
        "SHEET_DRAFT_VERSION_CONFLICT",
        "The draft version changed during the save.",
      ),
    };
  }

  if (committed.kind === "version_conflict") {
    try {
      await deps.sheetDraftHeadRepository.release(
        headIdentity,
        claimId,
        claimed.claimedVersion,
        deps.clock.now(),
      );
    } catch {
      // Best-effort compensation.
    }
    return {
      kind: "error",
      response: errorResponse("SHEET_DRAFT_VERSION_CONFLICT"),
    };
  }

  return { kind: "ok", draft: nextVersion };
}

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
    }
    return errorResponse("SHEET_DRAFT_MUTATION_INVALID", error.message);
  }
  return errorResponse("SHEET_DRAFT_MUTATION_INVALID");
}
