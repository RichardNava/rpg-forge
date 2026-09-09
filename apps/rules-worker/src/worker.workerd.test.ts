import { webCrypto } from "@repo/rules-analysis-session";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index.js";

const MIGRATION_DDL =
  'CREATE TABLE `rules_analysis_sessions` (`analysis_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX `rules_analysis_sessions_cleanup_idx` ON `rules_analysis_sessions` (`status`,`expires_at`); CREATE TABLE `rules_analysis_rulebooks` (`analysis_id` text PRIMARY KEY NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `size_bytes` integer NOT NULL, `page_count` integer, `chunk_count` integer, `extracted_chars` integer, `failure_code` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE UNIQUE INDEX `rules_analysis_rulebooks_ingestion_id_idx` ON `rules_analysis_rulebooks` (`ingestion_id`); CREATE INDEX `rules_analysis_rulebooks_cleanup_idx` ON `rules_analysis_rulebooks` (`status`,`updated_at`); CREATE TABLE `rules_analysis_runs` (`run_id` text PRIMARY KEY NOT NULL, `analysis_id` text NOT NULL, `ingestion_id` text NOT NULL, `status` text NOT NULL, `failure_code` text, `is_current` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL); CREATE INDEX `rules_analysis_runs_current_idx` ON `rules_analysis_runs` (`analysis_id`,`is_current`); CREATE INDEX `rules_analysis_runs_generation_idx` ON `rules_analysis_runs` (`analysis_id`,`ingestion_id`); CREATE INDEX `rules_analysis_runs_cleanup_idx` ON `rules_analysis_runs` (`status`,`updated_at`); CREATE UNIQUE INDEX `rules_analysis_runs_single_current_idx` ON `rules_analysis_runs` (`analysis_id`) WHERE "rules_analysis_runs"."is_current" = 1;';

interface SeededSession {
  analysisId: string;
  accessToken: string;
  tokenHash: string;
}

async function seedSession(
  db: D1Database,
  overrides: Partial<{ status: "ACTIVE" | "DELETING"; expired: boolean }> = {},
): Promise<SeededSession> {
  const analysisId = crypto.randomUUID();
  const accessToken = "seed-token-" + analysisId;
  const tokenHash = await webCrypto.sha256Hex(
    new TextEncoder().encode(accessToken),
  );
  const base = Date.now();
  const expiresAt =
    overrides.expired === true ? base - 1000 : base + 12 * 60 * 60 * 1000;
  await db
    .prepare(
      "INSERT INTO rules_analysis_sessions (analysis_id, token_hash, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      analysisId,
      tokenHash,
      overrides.status ?? "ACTIVE",
      base,
      base,
      expiresAt,
    )
    .run();
  return { analysisId, accessToken, tokenHash };
}

describe("rules-worker integration with real D1", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("GET returns a public session view via the real D1 adapter", async () => {
    const seeded = await seedSession(db);
    const response = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}`,
        { headers: { authorization: `Bearer ${seeded.accessToken}` } },
      ),
      { DB: db },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.analysisId).toBe(seeded.analysisId);
    expect(body.status).toBe("ACTIVE");
    expect(body).not.toHaveProperty("tokenHash");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("GET returns 404 for an unknown or unauthorized session", async () => {
    const seeded = await seedSession(db);
    const unknown = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${crypto.randomUUID()}`,
        { headers: { authorization: `Bearer not-a-token` } },
      ),
      { DB: db },
    );
    const wrongToken = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}`,
        { headers: { authorization: `Bearer not-a-token` } },
      ),
      { DB: db },
    );
    expect(unknown.status).toBe(404);
    expect(wrongToken.status).toBe(404);
  });

  it("requires the token in the Authorization header only", async () => {
    const seeded = await seedSession(db);
    const response = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}?accessToken=${seeded.accessToken}`,
      ),
      { DB: db },
    );
    expect(response.status).toBe(400);
  });

  it("returns 410 for an expired session with valid credentials", async () => {
    const seeded = await seedSession(db, { expired: true });
    const response = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}`,
        { headers: { authorization: `Bearer ${seeded.accessToken}` } },
      ),
      { DB: db },
    );
    expect(response.status).toBe(410);
  });

  it("DELETE removes an authorized session", async () => {
    const seeded = await seedSession(db);
    const response = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${seeded.accessToken}` },
        },
      ),
      { DB: db },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
    const remaining = await db
      .prepare(
        "SELECT analysis_id FROM rules_analysis_sessions WHERE analysis_id = ?",
      )
      .bind(seeded.analysisId)
      .first();
    expect(remaining).toBeNull();
  });

  it("DELETE requires valid credentials and preserves the row otherwise", async () => {
    const seeded = await seedSession(db);
    const response = await worker.fetch(
      new Request(
        `https://rules-worker.test/v1/rules-analysis/sessions/${seeded.analysisId}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer not-a-token` },
        },
      ),
      { DB: db },
    );
    expect(response.status).toBe(404);
    const remaining = await db
      .prepare(
        "SELECT analysis_id, status FROM rules_analysis_sessions WHERE analysis_id = ?",
      )
      .bind(seeded.analysisId)
      .first<{ analysis_id: string; status: string }>();
    expect(remaining?.status).toBe("ACTIVE");
  });

  it("treats session creation without turnstile secret as unavailable and fails closed", async () => {
    const response = await worker.fetch(
      new Request("https://rules-worker.test/v1/rules-analysis/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: "fake" }),
      }),
      { DB: db, RATE_LIMIT_MODE: "local" },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("HUMAN_VERIFICATION_REQUIRED");
  });

  it("fails closed on creation when the production RATE_LIMITER binding is missing, even with turnstile configured", async () => {
    const count = async () => {
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM rules_analysis_sessions")
        .first<{ n: number }>();
      return row?.n ?? 0;
    };
    const before = await count();
    const response = await worker.fetch(
      new Request("https://rules-worker.test/v1/rules-analysis/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: "fake" }),
      }),
      { DB: db, TURNSTILE_SECRET: "configured-secret" },
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMIT_UNAVAILABLE");
    expect(await count()).toBe(before);
  });
});
