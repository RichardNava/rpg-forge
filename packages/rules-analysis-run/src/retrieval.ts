import { z } from "zod";
import { RETRIEVAL_TOP_K } from "./model.js";

export const RetrievalEvidenceSchema = z.strictObject({
  chunkId: z.string().min(1).max(200),
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
});

export type RetrievalEvidence = z.infer<typeof RetrievalEvidenceSchema>;

export const RetrievalRecordSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid(),
  analysisId: z.uuid(),
  ingestionId: z.uuid(),
  queryText: z.string().max(2_000),
  retrieved: z.array(RetrievalEvidenceSchema).max(RETRIEVAL_TOP_K),
});

export type RetrievalRecord = z.infer<typeof RetrievalRecordSchema>;

export function serializeRetrievalRecord(record: RetrievalRecord): string {
  return JSON.stringify(RetrievalRecordSchema.parse(record));
}
