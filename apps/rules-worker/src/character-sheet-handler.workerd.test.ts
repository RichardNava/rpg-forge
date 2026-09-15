import { webCrypto } from "@repo/rules-analysis-session";
import type { CharacterSheetDraft } from "@repo/character-sheet-draft";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index.js";
import { createR2CharacterSheetDraftStore } from "./infrastructure/r2-character-sheet-drafts.js";

const MIGRATION_DDL =
  "CREATE TABLE IF NOT EXISTS `sheet_sessions` (`session_id` text PRIMARY KEY NOT NULL, `token_hash` text NOT NULL, `status` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `expires_at` integer NOT NULL); CREATE INDEX IF NOT EXISTS `sheet_sessions_cleanup_idx` ON `sheet_sessions` (`status`,`expires_at`); CREATE TABLE IF NOT EXISTS `sheet_draft_heads` (`session_id` text NOT NULL, `draft_id` text NOT NULL, `current_version` integer NOT NULL, `pending_version` integer, `pending_claim_id` text, `pending_since` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`session_id`,`draft_id`)); CREATE INDEX IF NOT EXISTS `sheet_draft_heads_session_idx` ON `sheet_draft_heads` (`session_id`); CREATE INDEX IF NOT EXISTS `sheet_draft_heads_pending_idx` ON `sheet_draft_heads` (`pending_version`,`pending_since`);";

interface SeededSheetSession {
  sessionId: string;
  accessToken: string;
}

async function seedSheetSession(db: D1Database): Promise<SeededSheetSession> {
  const sessionId = crypto.randomUUID();
  const accessToken = `seed-sheet-token-${sessionId}`;
  const tokenHash = await webCrypto.sha256Hex(
    new TextEncoder().encode(accessToken),
  );
  const base = Date.now();
  const expiresAt = base + 120 * 60 * 1000;
  await db
    .prepare(
      "INSERT INTO sheet_sessions (session_id, token_hash, status, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(sessionId, tokenHash, "ACTIVE", base, base, expiresAt)
    .run();
  return { sessionId, accessToken };
}

function bucket(): R2Bucket {
  const bound = env.SHEET_ARTIFACTS as R2Bucket | undefined;
  if (bound === undefined) {
    throw new Error("SHEET_ARTIFACTS binding is missing from env.local config");
  }
  return bound;
}

function makeDraft(sessionId: string, draftId: string): CharacterSheetDraft {
  return {
    schemaVersion: "1",
    draftId,
    sessionId,
    baseVersion: 1,
    version: 1,
    mode: "pc",
    characterName: "Aria Stone",
    rulesContextId: null,
    fields: [
      {
        key: "character_name",
        label: "Character Name",
        type: "text",
        locked: false,
      },
      {
        key: "strength",
        label: "Strength",
        type: "number",
        min: 1,
        max: 20,
        locked: true,
      },
      { key: "homeland", label: "Homeland", type: "textarea", locked: false },
      {
        key: "weapon",
        label: "Weapon",
        type: "choice",
        options: ["sword", "bow", "staff"],
        locked: true,
      },
    ],
    values: {
      character_name: "Aria Stone",
      strength: 12,
      homeland: "Riverside",
      weapon: "sword",
    },
    source: { sourceSheetId: "sheet.0001", sourceRunId: null },
    confirmed: false,
  };
}

function request(
  path: string,
  token: string,
  init: {
    method?: string;
    body?: unknown;
  } = {},
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  const options: RequestInit = { method: init.method ?? "GET", headers };
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(init.body);
  }
  return new Request(`https://rules-worker.test${path}`, options);
}

describe("character-sheet draft HTTP API with real D1 and R2", () => {
  let db: D1Database;

  beforeAll(async () => {
    db = env.DB as D1Database;
    await db.exec(MIGRATION_DDL);
  });

  it("treats session creation without a turnstile secret as unavailable", async () => {
    const response = await worker.fetch(
      new Request("https://rules-worker.test/v1/character-sheets/sessions", {
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

  it("round-trips a session view through the real D1 adapter", async () => {
    const seeded = await seedSheetSession(db);
    const response = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${seeded.sessionId}`,
        seeded.accessToken,
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessionId: string;
      status: string;
    };
    expect(body.sessionId).toBe(seeded.sessionId);
    expect(body.status).toBe("ACTIVE");
  });

  it("rejects a wrong token against a real session row", async () => {
    const seeded = await seedSheetSession(db);
    const response = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${seeded.sessionId}`,
        "not-the-token",
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(response.status).toBe(404);
  });

  it("creates, edits, reads back and rerolls a draft via real D1 and R2", async () => {
    const seeded = await seedSheetSession(db);
    const { sessionId, accessToken } = seeded;
    const draftId = crypto.randomUUID();

    const create = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts`,
        accessToken,
        { method: "POST", body: makeDraft(sessionId, draftId) },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as CharacterSheetDraft;
    expect(created.version).toBe(1);

    const patch = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
        accessToken,
        {
          method: "PATCH",
          body: { op: "set_value", key: "homeland", value: "Harbor Town" },
        },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(patch.status).toBe(200);
    const v2 = (await patch.json()) as CharacterSheetDraft;
    expect(v2.version).toBe(2);
    expect(v2.values["homeland"]).toBe("Harbor Town");

    const latest = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
        accessToken,
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(latest.status).toBe(200);
    expect(
      ((await latest.json()) as CharacterSheetDraft).values["homeland"],
    ).toBe("Harbor Town");

    const original = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}?version=1`,
        accessToken,
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(original.status).toBe(200);
    expect(
      ((await original.json()) as CharacterSheetDraft).values["homeland"],
    ).toBe("Riverside");

    const reroll = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}/reroll`,
        accessToken,
        { method: "POST", body: { seed: "workerd-seed" } },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(reroll.status).toBe(200);
    const rerollBody = (await reroll.json()) as {
      draft: CharacterSheetDraft;
      rerolledKeys: string[];
    };
    expect(rerollBody.draft.version).toBe(3);
    expect(rerollBody.rerolledKeys.sort()).toEqual(["strength", "weapon"]);

    const store = createR2CharacterSheetDraftStore(bucket());
    const stored = await store.getLatestDraft({ sessionId, draftId });
    expect(stored?.version).toBe(3);
    expect(stored?.values["strength"]).toBe(
      rerollBody.draft.values["strength"],
    );
  });

  it("returns 409 for a duplicate create without corrupting the stored snapshot", async () => {
    const seeded = await seedSheetSession(db);
    const { sessionId, accessToken } = seeded;
    const draftId = crypto.randomUUID();

    const first = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts`,
        accessToken,
        { method: "POST", body: makeDraft(sessionId, draftId) },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(first.status).toBe(201);

    const second = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts`,
        accessToken,
        { method: "POST", body: makeDraft(sessionId, draftId) },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_DRAFT_ALREADY_EXISTS");

    const store = createR2CharacterSheetDraftStore(bucket());
    const latest = await store.getLatestDraft({ sessionId, draftId });
    expect(latest?.version).toBe(1);
    expect(latest?.characterName).toBe("Aria Stone");
  });

  it("fails closed with 503 when the R2 draft store binding is absent", async () => {
    const seeded = await seedSheetSession(db);
    const { sessionId, accessToken } = seeded;
    const draftId = crypto.randomUUID();

    const response = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts`,
        accessToken,
        { method: "POST", body: makeDraft(sessionId, draftId) },
      ),
      { DB: db },
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SHEET_DRAFT_STORAGE_UNAVAILABLE");

    const head = await db
      .prepare(
        "SELECT current_version FROM sheet_draft_heads WHERE session_id = ? AND draft_id = ?",
      )
      .bind(sessionId, draftId)
      .first();
    expect(head).toBeNull();
  });
});
