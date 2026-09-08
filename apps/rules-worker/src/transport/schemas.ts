import { z } from "zod";
import { PublicRulebookSchema } from "@repo/rulebook-ingestion";

export const ErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "HUMAN_VERIFICATION_REQUIRED",
  "HUMAN_VERIFICATION_FAILED",
  "RATE_LIMITED",
  "RATE_LIMIT_UNAVAILABLE",
  "RULEBOOK_UPLOAD_CONSENT_REQUIRED",
  "RULEBOOK_INVALID_CONTENT_TYPE",
  "RULEBOOK_TOO_LARGE",
  "RULEBOOK_INVALID_PDF",
  "RULEBOOK_TOO_MANY_PAGES",
  "RULEBOOK_REQUIRES_OCR",
  "RULEBOOK_ALREADY_ATTACHED",
  "RULEBOOK_NOT_FOUND",
  "RULEBOOK_STORAGE_UNAVAILABLE",
  "RULEBOOK_WORKFLOW_UNAVAILABLE",
  "RULEBOOK_PROCESSING_FAILED",
  "RULEBOOK_EXTRACTION_TOO_LARGE",
  "RULEBOOK_TOO_MANY_CHUNKS",
  "ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
  "ANALYSIS_SESSION_EXPIRED",
  "ANALYSIS_SESSION_DELETE_FAILED",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorCodeSet = ErrorCodeSchema.enum;

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CreateSessionRequestSchema = z.strictObject({
  turnstileToken: z.string().min(1).max(4096),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.strictObject({
  analysisId: z.uuid(),
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const SessionViewSchema = z.strictObject({
  analysisId: z.uuid(),
  status: z.enum(["ACTIVE", "DELETING"]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export type SessionView = z.infer<typeof SessionViewSchema>;

export const RulebookViewSchema = PublicRulebookSchema;
export type RulebookView = z.infer<typeof RulebookViewSchema>;

export const AnalysisIdSchema = z.uuid();

export const DeleteSessionResponseSchema = z.strictObject({
  deleted: z.literal(true),
});
