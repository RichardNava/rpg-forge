import { z } from "zod";
import {
  SheetDraftConfirmRequestV2Schema,
  SheetDraftCreateRequestV2Schema,
  SheetDraftMutationRequestV2Schema,
  SheetDraftRerollRequestV2Schema,
  SheetDraftRerollResponseV2Schema,
  SheetDraftSnapshotResponseV2Schema,
  type CharacterSheetDraftV2,
  type SheetDraftConfirmRequestV2,
  type SheetDraftCreateRequestV2,
  type SheetDraftMutationRequestV2,
  type SheetDraftRerollRequestV2,
  type SheetDraftRerollResponseV2,
} from "@repo/character-sheet-draft";
import {
  CHARACTER_SHEET_API_PREFIX,
  SheetSessionSchema,
  SheetSessionViewSchema,
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
import type { SheetFetch } from "./sheet-api-client";

export interface SheetApiClientV2Options {
  /** Same-origin base path; defaults to `/api/character-sheets`. */
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: SheetFetch;
}

/**
 * The V2 API surface the V2 rehydration store depends on. Parallel to the live
 * V1 `SheetApiClientPort` and NOT consumed by any live route: every envelope
 * carries the frozen V2 transport contract (`expectedVersion` on all
 * post-create operations, raw canonical V2 responses, no `{ draft }`
 * wrapper on confirm).
 */
export interface SheetApiClientV2Port {
  createSession(turnstileToken: string): Promise<SheetSession>;
  getSession(sessionId: string, accessToken: string): Promise<SheetSessionView>;
  createDraft(
    sessionId: string,
    accessToken: string,
    request: SheetDraftCreateRequestV2,
  ): Promise<CharacterSheetDraftV2>;
  getDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    version?: number,
  ): Promise<CharacterSheetDraftV2>;
  mutateDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftMutationRequestV2,
  ): Promise<CharacterSheetDraftV2>;
  rerollDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftRerollRequestV2,
  ): Promise<SheetDraftRerollResponseV2>;
  confirmDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftConfirmRequestV2,
  ): Promise<CharacterSheetDraftV2>;
}

export class SheetApiClientV2 implements SheetApiClientV2Port {
  private readonly baseUrl: string;
  private readonly fetchImpl: SheetFetch;

  constructor(options: SheetApiClientV2Options = {}) {
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
    request: SheetDraftCreateRequestV2,
  ): Promise<CharacterSheetDraftV2> {
    const validated = SheetDraftCreateRequestV2Schema.safeParse(request);
    if (!validated.success) {
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
      body: validated.data,
    });
    return parseJsonBody(response, SheetDraftSnapshotResponseV2Schema);
  }

  async getDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    version?: number,
  ): Promise<CharacterSheetDraftV2> {
    const url = this.draftUrl(sessionId, draftId, version);
    const response = await this.request({
      method: "GET",
      url,
      accessToken,
    });
    return parseJsonBody(response, SheetDraftSnapshotResponseV2Schema);
  }

  async mutateDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftMutationRequestV2,
  ): Promise<CharacterSheetDraftV2> {
    const validated = SheetDraftMutationRequestV2Schema.safeParse(request);
    if (!validated.success) {
      throw new SheetApiError(
        "INVALID_REQUEST",
        "The mutation request must carry an expectedVersion and a mutation.",
        400,
      );
    }
    const response = await this.request({
      method: "PATCH",
      url: this.draftUrl(sessionId, draftId),
      accessToken,
      body: validated.data,
    });
    return parseJsonBody(response, SheetDraftSnapshotResponseV2Schema);
  }

  async rerollDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftRerollRequestV2,
  ): Promise<SheetDraftRerollResponseV2> {
    const validated = SheetDraftRerollRequestV2Schema.safeParse(request);
    if (!validated.success) {
      throw new SheetApiError(
        "INVALID_REQUEST",
        "The reroll request must carry an expectedVersion and a seed.",
        400,
      );
    }
    const response = await this.request({
      method: "POST",
      url: this.rerollUrl(sessionId, draftId),
      accessToken,
      body: validated.data,
    });
    return parseJsonBody(response, SheetDraftRerollResponseV2Schema);
  }

  async confirmDraft(
    sessionId: string,
    accessToken: string,
    draftId: string,
    request: SheetDraftConfirmRequestV2,
  ): Promise<CharacterSheetDraftV2> {
    const validated = SheetDraftConfirmRequestV2Schema.safeParse(request);
    if (!validated.success) {
      throw new SheetApiError(
        "INVALID_REQUEST",
        "The confirm request must carry an expectedVersion.",
        400,
      );
    }
    const response = await this.request({
      method: "POST",
      url: this.confirmUrl(sessionId, draftId),
      accessToken,
      body: validated.data,
    });
    return parseJsonBody(response, SheetDraftSnapshotResponseV2Schema);
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
