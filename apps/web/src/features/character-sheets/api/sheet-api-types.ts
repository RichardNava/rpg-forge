import { z } from "zod";

export const CHARACTER_SHEET_API_PREFIX = "/api/character-sheets";

export interface SheetSessionCreateRequest {
  turnstileToken: string;
}

export interface SheetSession {
  sessionId: string;
  accessToken: string;
  expiresAt: string;
}

export const SheetSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export type SheetSessionStatus = "ACTIVE" | "DELETING";

export interface SheetSessionView {
  sessionId: string;
  status: SheetSessionStatus;
  expiresAt: string;
}

export const SheetSessionViewSchema = z.strictObject({
  sessionId: z.uuid(),
  status: z.enum(["ACTIVE", "DELETING"]),
  expiresAt: z.iso.datetime(),
});
