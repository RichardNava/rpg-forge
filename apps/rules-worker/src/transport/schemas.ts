import { z } from "zod";
import { PublicRulebookSchema } from "@repo/rulebook-ingestion";
import {
  RuleBuildFailureCodeSchema,
  RulesAnalysisRequestSchema as RulesAnalysisRequestDomainSchema,
  RulesAnalysisRunStatusSchema,
} from "@repo/rules-analysis-run";
import { RulesContextSchema } from "@repo/rules-context";

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
  "RULES_CONTEXT_NO_READY_RULEBOOK",
  "RULES_CONTEXT_STORAGE_UNAVAILABLE",
  "RULES_CONTEXT_INDEX_UNAVAILABLE",
  "RULES_CONTEXT_MODEL_UNAVAILABLE",
  "RULES_CONTEXT_RUN_NOT_FOUND",
  "RULES_CONTEXT_ALREADY_READY",
  "RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID",
  "RULES_CONTEXT_ANALYSIS_FAILED",
  "RULES_CONTEXT_INVALID_CONFIRMATION",
  "ANALYSIS_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
  "ANALYSIS_SESSION_EXPIRED",
  "ANALYSIS_SESSION_DELETE_FAILED",
  "SHEET_SESSION_NOT_FOUND_OR_UNAUTHORIZED",
  "SHEET_SESSION_EXPIRED",
  "SHEET_DOCUMENT_INVALID_REQUEST",
  "SHEET_DOCUMENT_INVALID_TYPE",
  "SHEET_DOCUMENT_INVALID_CONTENT",
  "SHEET_DOCUMENT_TOO_LARGE",
  "SHEET_DOCUMENT_EXTRACTION_UNAVAILABLE",
  "SHEET_DOCUMENT_EXTRACTION_FAILED",
  "SHEET_DRAFT_INVALID",
  "SHEET_DRAFT_STORAGE_UNAVAILABLE",
  "SHEET_DRAFT_CORRUPT",
  "SHEET_DRAFT_NOT_FOUND",
  "SHEET_DRAFT_ALREADY_EXISTS",
  "SHEET_DRAFT_VERSION_CONFLICT",
  "SHEET_DRAFT_INFLIGHT",
  "SHEET_DRAFT_CONFIRMED",
  "SHEET_DRAFT_MUTATION_INVALID",
  "SHEET_DRAFT_FIELD_READ_LOCKED",
  "SHEET_DRAFT_SURFACE_OUT_OF_BOUNDS",
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

export const RulesAnalysisRequestSchema = RulesAnalysisRequestDomainSchema;
export type RulesAnalysisRequest = z.infer<typeof RulesAnalysisRequestSchema>;

export const ConfirmationRequestSchema = z.strictObject({});
export type ConfirmationRequest = z.infer<typeof ConfirmationRequestSchema>;

export const PublicRulesAnalysisRunSchema = z.strictObject({
  runId: z.uuid(),
  analysisId: z.uuid(),
  status: RulesAnalysisRunStatusSchema,
  failure: RuleBuildFailureCodeSchema.nullable(),
});
export type PublicRulesAnalysisRunView = z.infer<
  typeof PublicRulesAnalysisRunSchema
>;

export const RulesContextBeginResponseSchema = z.strictObject({
  run: PublicRulesAnalysisRunSchema,
});
export type RulesContextBeginResponse = z.infer<
  typeof RulesContextBeginResponseSchema
>;

export const RulesContextReadResponseSchema = z.strictObject({
  run: PublicRulesAnalysisRunSchema,
  context: RulesContextSchema.nullable(),
});
export type RulesContextReadResponse = z.infer<
  typeof RulesContextReadResponseSchema
>;

export const RulesContextConfirmResponseSchema = z.strictObject({
  run: PublicRulesAnalysisRunSchema,
});
export type RulesContextConfirmResponse = z.infer<
  typeof RulesContextConfirmResponseSchema
>;

// --- Character-sheet session and draft schemas ---

export const SheetSessionCreateResponseSchema = z.strictObject({
  sessionId: z.uuid(),
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

export type SheetSessionCreateResponse = z.infer<
  typeof SheetSessionCreateResponseSchema
>;

export const SheetSessionViewSchema = z.strictObject({
  sessionId: z.uuid(),
  status: z.enum(["ACTIVE", "DELETING"]),
  expiresAt: z.iso.datetime(),
});

export type SheetSessionView = z.infer<typeof SheetSessionViewSchema>;

export const SheetDraftCreateResponseSchema = z.strictObject({
  draftId: z.string().min(1),
  sessionId: z.string().min(1),
  version: z.number().int().min(1),
});

export type SheetDraftCreateResponse = z.infer<
  typeof SheetDraftCreateResponseSchema
>;

export const SheetDraftRerollRequestSchema = z.strictObject({
  seed: z.string().min(1).max(256),
});

export type SheetDraftRerollRequest = z.infer<
  typeof SheetDraftRerollRequestSchema
>;
