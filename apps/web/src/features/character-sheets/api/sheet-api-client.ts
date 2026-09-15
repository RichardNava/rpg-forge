import { z } from "zod";
import {
  CharacterSheetDraftSchema,
  type CharacterSheetDraft,
  type DraftMutation,
} from "@repo/character-sheet-draft";
import {
  CHARACTER_SHEET_API_PREFIX,
  SheetDraftRerollResponseSchema,
  SheetSessionSchema,
  SheetSessionViewSchema,
  type SheetDraftRerollResponse,
  type SheetSession,
  type SheetSessionView,
} from "./sheet-api-types";
import { isSheetIdentitySegment } from "./sheet-identity-segments";
import {
  SHEET_API_CLIENT_CODES,
  SHEET_API_PROXY_CODES,
  SheetApiError,
  parseSheetApiErrorBody,
} from "./sheet-api-errors";

export interface SheetFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface SheetApiClientOptions {
  /** Same-origin base path; defaults to `/api/character-sheets`. */
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: SheetFetch;
}

/**
 * The API surface the web rehydration store depends on. Kept as an interface
 * so the store stays framework-independent and testable with fakes.
 */
export interface SheetApiClientPort {
  createSession(turnstileToken: string): Promise<SheetSession>;
  getSession(sessionId: string, accessToken: string): Promise<SheetSessionView>;
  createDraft(
    sessionId: string,
    accessToken: string,
    draft: CharacterSheetDraft,
  ): Promise<CharacterSheetDraft>;
  getDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    version?: number,
  ): Promise<CharacterSheetDraft>;
  mutateDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    mutation: DraftMutation,
  ): Promise<CharacterSheetDraft>;
  rerollDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    seed: string,
  ): Promise<SheetDraftRerollResponse>;
  confirmDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
  ): Promise<CharacterSheetDraft>;
}

export class SheetApiClient implements SheetApiClientPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: SheetFetch;

  constructor(options: SheetApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? CHARACTER_SHEET_API_PREFIX;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async createSession(turnstileToken: string): Promise<SheetSession> {
    const response = await this.request({
      method: "POST",
      url: `${this.baseUrl}/sessions`,
      accessToken: null,
      body: { turnstileToken },
    });
    return parseJsonBody(response, SheetSessionSchema);
  }

  async getSession(
    sessionId: string,
    accessToken: string,
  ): Promise<SheetSessionView> {
    const response = await this.request({
      method: "GET",
      url: this.sessionUrl(sessionId),
      accessToken,
    });
    return parseJsonBody(response, SheetSessionViewSchema);
  }

  async createDraft(
    sessionId: string,
    accessToken: string,
    draft: CharacterSheetDraft,
  ): Promise<CharacterSheetDraft> {
    const validateDraft = CharacterSheetDraftSchema.safeParse(draft);
    if (!validateDraft.success) {
      throw new SheetApiError(
        "SHEET_DRAFT_INVALID",
        "The draft is invalid: check the snapshot before creating it.",
        400,
      );
    }
    const response = await this.request({
      method: "POST",
      url: this.draftsUrl(sessionId),
      accessToken,
      body: draft,
    });
    return parseJsonBody(response, CharacterSheetDraftSchema);
  }

  async getDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    version?: number,
  ): Promise<CharacterSheetDraft> {
    const url = this.draftUrl(sessionId, draftId, version);
    const response = await this.request({
      method: "GET",
      url,
      accessToken,
    });
    return parseJsonBody(response, CharacterSheetDraftSchema);
  }

  async mutateDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    mutation: DraftMutation,
  ): Promise<CharacterSheetDraft> {
    const response = await this.request({
      method: "PATCH",
      url: this.draftUrl(sessionId, draftId),
      accessToken,
      body: mutation,
    });
    return parseJsonBody(response, CharacterSheetDraftSchema);
  }

  async rerollDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    seed: string,
  ): Promise<SheetDraftRerollResponse> {
    const response = await this.request({
      method: "POST",
      url: this.rerollUrl(sessionId, draftId),
      accessToken,
      body: { seed },
    });
    return parseJsonBody(response, SheetDraftRerollResponseSchema);
  }

  async confirmDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
  ): Promise<CharacterSheetDraft> {
    const response = await this.request({
      method: "POST",
      url: this.confirmUrl(sessionId, draftId),
      accessToken,
    });
    return parseJsonBody(response, CharacterSheetDraftSchema);
  }

  private request(input: {
    method: string;
    url: string;
    accessToken: string | null;
    body?: unknown;
  }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (input.accessToken !== null) {
      headers.authorization = `Bearer ${input.accessToken}`;
    }
    let body: string | undefined;
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const init: RequestInit = { method: input.method, headers };
    if (body !== undefined) {
      init.body = body;
    }
    return this.fetchImpl(input.url, init).then(async (response) => {
      if (!response.ok) {
        throw await toSheetApiError(response);
      }
      return response;
    });
  }

  private sessionUrl(sessionId: string): string {
    assertIdentitySegment(sessionId, "sessionId");
    return `${this.baseUrl}/sessions/${sessionId}`;
  }

  private draftsUrl(sessionId: string): string {
    assertIdentitySegment(sessionId, "sessionId");
    return `${this.baseUrl}/sessions/${sessionId}/drafts`;
  }

  private draftUrl(
    sessionId: string,
    draftId: string,
    version?: number,
  ): string {
    assertIdentitySegment(sessionId, "sessionId");
    assertIdentitySegment(draftId, "draftId");
    if (version !== undefined) {
      if (!Number.isInteger(version) || version < 1) {
        throw new SheetApiError(
          "INVALID_REQUEST",
          "A draft version must be a positive integer.",
          400,
        );
      }
      return `${this.baseUrl}/sessions/${sessionId}/drafts/${draftId}?version=${version}`;
    }
    return `${this.baseUrl}/sessions/${sessionId}/drafts/${draftId}`;
  }

  private rerollUrl(sessionId: string, draftId: string): string {
    assertIdentitySegment(sessionId, "sessionId");
    assertIdentitySegment(draftId, "draftId");
    return `${this.baseUrl}/sessions/${sessionId}/drafts/${draftId}/reroll`;
  }

  private confirmUrl(sessionId: string, draftId: string): string {
    assertIdentitySegment(sessionId, "sessionId");
    assertIdentitySegment(draftId, "draftId");
    return `${this.baseUrl}/sessions/${sessionId}/drafts/${draftId}/confirm`;
  }
}

function assertIdentitySegment(value: string, label: string): void {
  if (!isSheetIdentitySegment(value)) {
    throw new SheetApiError(
      SHEET_API_PROXY_CODES.INVALID_REQUEST,
      `The ${label} is not a valid character-sheet identity segment.`,
      400,
    );
  }
}

async function toSheetApiError(response: Response): Promise<SheetApiError> {
  const { status } = response;
  try {
    const body = (await response.json()) as unknown;
    const parsed = parseSheetApiErrorBody(body, status);
    if (parsed !== null) {
      return parsed;
    }
  } catch {
    // Fall through to a generic transport error.
  }
  return new SheetApiError(
    SHEET_API_CLIENT_CODES.INVALID_RESPONSE,
    `The character-sheet service responded with status ${status}.`,
    status,
  );
}

async function parseJsonBody<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new SheetApiError(
      SHEET_API_CLIENT_CODES.INVALID_RESPONSE,
      "The character-sheet service returned a non-JSON response.",
      response.status,
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SheetApiError(
      SHEET_API_CLIENT_CODES.INVALID_RESPONSE,
      "The character-sheet service returned an unexpected payload.",
      response.status,
    );
  }
  return parsed.data;
}
