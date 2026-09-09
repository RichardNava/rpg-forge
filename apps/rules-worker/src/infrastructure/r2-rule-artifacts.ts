import {
  RulesAnalysisInputArtifactSchema,
  RulesAnalysisVectorManifestSchema,
  RetrievalRecordSchema,
  type RulesAnalysisInputArtifact,
  type RunArtifactPort,
} from "@repo/rules-analysis-run";
import { RulesContextSchema } from "@repo/rules-context";

export interface RunArtifactKeys {
  input: string;
  context: string;
  retrieval: string;
  manifest: string;
}

function getRunArtifactKeys(
  analysisId: string,
  ingestionId: string,
  runId: string,
): RunArtifactKeys {
  const prefix = `temp/rules/${analysisId}/${ingestionId}/run/${runId}`;
  return {
    input: `${prefix}/input.json`,
    context: `${prefix}/context.json`,
    retrieval: `${prefix}/retrieval.json`,
    manifest: `${prefix}/vector-manifest.json`,
  };
}

export class RuleArtifactUnavailableError extends Error {
  constructor() {
    super("Rule analysis artifacts are unavailable.");
    this.name = "RuleArtifactUnavailableError";
  }
}

/**
 * Generation-scoped temporary run artifacts in R2. Every key embeds the
 * analysisId, ingestionId, and runId, so a stale run can never address another
 * run's objects. Read paths re-validate the embedded identity and throw on
 * corruption rather than returning partial data.
 */
export function createR2RuleArtifacts(bucket: R2Bucket): RunArtifactPort {
  return {
    async putInput(input) {
      const artifact: RulesAnalysisInputArtifact = {
        version: 1,
        runId: input.runId,
        analysisId: input.analysisId,
        ingestionId: input.ingestionId,
        characterIntent: input.characterIntent,
        ruleOverrides: [...input.ruleOverrides],
      };
      const payload = JSON.stringify(
        RulesAnalysisInputArtifactSchema.parse(artifact),
      );
      await putJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .input,
        payload,
      );
    },

    async getInput(input) {
      const object = await getJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .input,
      );
      if (object === null) {
        return null;
      }
      const artifact = RulesAnalysisInputArtifactSchema.parse(object);
      assertArtifactIdentity(input, artifact.analysisId, artifact.ingestionId);
      return artifact;
    },

    async putContext(input) {
      const payload = JSON.stringify(RulesContextSchema.parse(input.context));
      await putJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .context,
        payload,
      );
    },

    async getContext(input) {
      const object = await getJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .context,
      );
      if (object === null) {
        return null;
      }
      return RulesContextSchema.parse(object);
    },

    async putRetrieval(input) {
      const payload = JSON.stringify(
        RetrievalRecordSchema.parse(input.retrieval),
      );
      await putJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .retrieval,
        payload,
      );
    },

    async putVectorManifest(input) {
      const manifest = {
        version: 1,
        runId: input.runId,
        analysisId: input.analysisId,
        ingestionId: input.ingestionId,
        vectorIds: [...input.vectorIds],
      };
      const payload = JSON.stringify(
        RulesAnalysisVectorManifestSchema.parse(manifest),
      );
      await putJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .manifest,
        payload,
      );
    },

    async getVectorManifest(input) {
      const object = await getJson(
        bucket,
        getRunArtifactKeys(input.analysisId, input.ingestionId, input.runId)
          .manifest,
      );
      if (object === null) {
        return null;
      }
      const manifest = RulesAnalysisVectorManifestSchema.parse(object);
      assertArtifactIdentity(input, manifest.analysisId, manifest.ingestionId);
      return manifest.vectorIds;
    },

    async deleteRunArtifacts(input) {
      const keys = getRunArtifactKeys(
        input.analysisId,
        input.ingestionId,
        input.runId,
      );
      try {
        await bucket.delete([
          keys.input,
          keys.context,
          keys.retrieval,
          keys.manifest,
        ]);
      } catch {
        throw new RuleArtifactUnavailableError();
      }
    },
  };
}

function assertArtifactIdentity(
  input: { analysisId: string; ingestionId: string },
  analysisId: string,
  ingestionId: string,
): void {
  if (input.analysisId !== analysisId || input.ingestionId !== ingestionId) {
    throw new RuleArtifactUnavailableError();
  }
}

async function putJson(
  bucket: R2Bucket,
  key: string,
  payload: string,
): Promise<void> {
  try {
    await bucket.put(key, payload, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch {
    throw new RuleArtifactUnavailableError();
  }
}

async function getJson(bucket: R2Bucket, key: string): Promise<unknown | null> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw new RuleArtifactUnavailableError();
  }
  if (object === null) {
    return null;
  }
  try {
    return JSON.parse(await object.text()) as unknown;
  } catch {
    throw new RuleArtifactUnavailableError();
  }
}
