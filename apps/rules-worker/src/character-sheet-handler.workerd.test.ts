import { webCrypto } from "@repo/rules-analysis-session";
import {
  getDraftSnapshotKey,
  type CharacterSheetDraft,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index.js";
import { createR2CharacterSheetDraftStoreV2 } from "./infrastructure/r2-character-sheet-drafts-v2.js";

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

function makeDraft(sessionId: string, draftId: string): CharacterSheetDraftV2 {
  return {
    schemaVersion: "2",
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
    sections: [],
    structure: [
      { kind: "field", key: "character_name", parentKey: null },
      { kind: "field", key: "strength", parentKey: null },
      { kind: "field", key: "homeland", parentKey: null },
      { kind: "field", key: "weapon", parentKey: null },
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

  it("creates, edits, reads back, rerolls and confirms a draft via real D1 and R2", async () => {
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
    const created = (await create.json()) as CharacterSheetDraftV2;
    expect(created.version).toBe(1);
    expect(created.schemaVersion).toBe("2");

    const patch = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
        accessToken,
        {
          method: "PATCH",
          body: {
            expectedVersion: 1,
            mutation: {
              op: "set_value",
              key: "homeland",
              value: "Harbor Town",
            },
          },
        },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(patch.status).toBe(200);
    const v2 = (await patch.json()) as CharacterSheetDraftV2;
    expect(v2.version).toBe(2);
    expect(v2.schemaVersion).toBe("2");
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
      ((await latest.json()) as CharacterSheetDraftV2).values["homeland"],
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
      ((await original.json()) as CharacterSheetDraftV2).values["homeland"],
    ).toBe("Riverside");

    const reroll = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}/reroll`,
        accessToken,
        { method: "POST", body: { expectedVersion: 2, seed: "workerd-seed" } },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(reroll.status).toBe(200);
    const rerollBody = (await reroll.json()) as {
      draft: CharacterSheetDraftV2;
      rerolledKeys: string[];
    };
    expect(rerollBody.draft.version).toBe(3);
    expect(rerollBody.draft.schemaVersion).toBe("2");
    expect(rerollBody.rerolledKeys.sort()).toEqual(["strength", "weapon"]);
    expect(rerollBody.draft.values["strength"]).not.toBe(12);

    const store = createR2CharacterSheetDraftStoreV2(bucket());
    const stored = await store.getLatestDraft({ sessionId, draftId });
    expect(stored?.version).toBe(3);
    expect(stored?.values["strength"]).toBe(
      rerollBody.draft.values["strength"],
    );

    const confirm = await worker.fetch(
      request(
        `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}/confirm`,
        accessToken,
        { method: "POST", body: { expectedVersion: 3 } },
      ),
      { DB: db, SHEET_ARTIFACTS: bucket() },
    );
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as CharacterSheetDraftV2;
    expect(confirmed.version).toBe(4);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed).not.toHaveProperty("draft");
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

    const store = createR2CharacterSheetDraftStoreV2(bucket());
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

  describe("spatial layout round-trip through the live routes (14.8)", () => {
    function makeLayoutDraft(
      sessionId: string,
      draftId: string,
    ): CharacterSheetDraftV2 {
      const base = makeDraft(sessionId, draftId);
      return {
        ...base,
        layout: {
          schemaVersion: "1",
          root: { columns: 2 },
          sections: {},
          nodes: {
            character_name: {
              columnStart: 1,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
            strength: {
              columnStart: 2,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
            homeland: {
              columnStart: 1,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
            weapon: {
              columnStart: 1,
              columnSpan: 1,
              rowSpan: 1,
              breakBefore: false,
            },
          },
        },
      };
    }

    async function readRawR2(key: string): Promise<string | null> {
      const object = await bucket().get(key);
      if (object === null) return null;
      return object.text();
    }

    it("creates with layout, patches container and node layout, confirms", async () => {
      const seeded = await seedSheetSession(db);
      const { sessionId, accessToken } = seeded;
      const draftId = crypto.randomUUID();
      const withEnv = { DB: db, SHEET_ARTIFACTS: bucket() };

      const create = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts`,
          accessToken,
          { method: "POST", body: makeLayoutDraft(sessionId, draftId) },
        ),
        withEnv,
      );
      expect(create.status).toBe(201);
      expect(
        ((await create.json()) as CharacterSheetDraftV2).layout?.root.columns,
      ).toBe(2);

      const get = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
        ),
        withEnv,
      );
      expect(get.status).toBe(200);
      expect(
        ((await get.json()) as CharacterSheetDraftV2).layout?.nodes["strength"],
      ).toEqual({
        columnStart: 2,
        columnSpan: 1,
        rowSpan: 1,
        breakBefore: false,
      });

      const containerPatch = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
          {
            method: "PATCH",
            body: {
              expectedVersion: 1,
              mutation: {
                op: "set_container_layout",
                containerKey: null,
                columns: 3,
              },
            },
          },
        ),
        withEnv,
      );
      expect(containerPatch.status).toBe(200);
      const afterContainer =
        (await containerPatch.json()) as CharacterSheetDraftV2;
      expect(afterContainer.version).toBe(2);
      expect(afterContainer.layout?.root.columns).toBe(3);

      const nodePatch = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
          {
            method: "PATCH",
            body: {
              expectedVersion: 2,
              mutation: {
                op: "set_node_layout",
                key: "homeland",
                placement: {
                  columnStart: 1,
                  columnSpan: 2,
                  rowSpan: 2,
                  breakBefore: true,
                },
              },
            },
          },
        ),
        withEnv,
      );
      expect(nodePatch.status).toBe(200);
      const afterNode = (await nodePatch.json()) as CharacterSheetDraftV2;
      expect(afterNode.version).toBe(3);
      expect(afterNode.layout?.nodes["homeland"]).toEqual({
        columnStart: 1,
        columnSpan: 2,
        rowSpan: 2,
        breakBefore: true,
      });

      const history = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}?version=1`,
          accessToken,
        ),
        withEnv,
      );
      expect(history.status).toBe(200);
      expect(
        ((await history.json()) as CharacterSheetDraftV2).layout?.root.columns,
      ).toBe(2);

      const confirm = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}/confirm`,
          accessToken,
          { method: "POST", body: { expectedVersion: 3 } },
        ),
        withEnv,
      );
      expect(confirm.status).toBe(200);
      const confirmed = (await confirm.json()) as CharacterSheetDraftV2;
      expect(confirmed.confirmed).toBe(true);
      expect(confirmed.layout?.nodes["homeland"]).toEqual({
        columnStart: 1,
        columnSpan: 2,
        rowSpan: 2,
        breakBefore: true,
      });
    });

    it("layoutless history gains explicit layout without rewriting history", async () => {
      const seeded = await seedSheetSession(db);
      const { sessionId, accessToken } = seeded;
      const draftId = crypto.randomUUID();
      const withEnv = { DB: db, SHEET_ARTIFACTS: bucket() };

      const create = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts`,
          accessToken,
          { method: "POST", body: makeDraft(sessionId, draftId) },
        ),
        withEnv,
      );
      expect(create.status).toBe(201);
      expect(
        ((await create.json()) as CharacterSheetDraftV2).layout,
      ).toBeUndefined();

      const v1Key = getDraftSnapshotKey(sessionId, draftId, 1);
      const storedV1 = await readRawR2(v1Key);
      expect(storedV1).not.toBeNull();

      const get = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
        ),
        withEnv,
      );
      expect(get.status).toBe(200);
      expect(
        ((await get.json()) as CharacterSheetDraftV2).layout,
      ).toBeUndefined();
      expect(await readRawR2(v1Key)).toBe(storedV1);

      const patch = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
          {
            method: "PATCH",
            body: {
              expectedVersion: 1,
              mutation: {
                op: "set_container_layout",
                containerKey: null,
                columns: 2,
              },
            },
          },
        ),
        withEnv,
      );
      expect(patch.status).toBe(200);
      const mutated = (await patch.json()) as CharacterSheetDraftV2;
      expect(mutated.version).toBe(2);
      expect(mutated.layout?.root.columns).toBe(2);
      expect(Object.keys(mutated.layout?.nodes ?? {}).sort()).toEqual([
        "character_name",
        "homeland",
        "strength",
        "weapon",
      ]);
      expect(await readRawR2(v1Key)).toBe(storedV1);
    });
  });

  describe("historical V1 persistence compatibility bridge", () => {
    function makeHistoricalV1(
      sessionId: string,
      draftId: string,
    ): CharacterSheetDraft {
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
            locked: false,
          },
        ],
        values: { character_name: "Aria Stone", strength: 12 },
        source: { sourceSheetId: "sheet.0001", sourceRunId: null },
        confirmed: false,
      };
    }

    async function readRawR2(key: string): Promise<string | null> {
      const object = await bucket().get(key);
      if (object === null) return null;
      return object.text();
    }

    it("V1 stored -> V2 HTTP -> V2 next write, V1 history immutable", async () => {
      const seeded = await seedSheetSession(db);
      const { sessionId, accessToken } = seeded;
      const draftId = crypto.randomUUID();
      const now = Date.now();

      // 2-3. Seed a valid historical V1 snapshot under the existing R2 v1 key
      // layout and point the D1 head at it.
      const historical = makeHistoricalV1(sessionId, draftId);
      const v1Key = getDraftSnapshotKey(sessionId, draftId, 1);
      const storedV1 = JSON.stringify(historical);
      await bucket().put(v1Key, storedV1);
      await db
        .prepare(
          "INSERT INTO sheet_draft_heads (session_id, draft_id, current_version, pending_version, pending_claim_id, pending_since, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        )
        .bind(sessionId, draftId, 1, now, now)
        .run();

      // 5. GET current serves canonical V2.
      const current = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
        ),
        { DB: db, SHEET_ARTIFACTS: bucket() },
      );
      expect(current.status).toBe(200);
      const currentBody = (await current.json()) as CharacterSheetDraftV2;
      expect(currentBody.schemaVersion).toBe("2");
      expect(currentBody.version).toBe(1);
      expect(currentBody.draftId).toBe(draftId);
      expect(currentBody.sessionId).toBe(sessionId);
      expect(currentBody.characterName).toBe("Aria Stone");
      expect(currentBody.values["strength"]).toBe(12);

      // 6. GET the exact historical version serves canonical V2.
      const historicalGet = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}?version=1`,
          accessToken,
        ),
        { DB: db, SHEET_ARTIFACTS: bucket() },
      );
      expect(historicalGet.status).toBe(200);
      const historicalBody =
        (await historicalGet.json()) as CharacterSheetDraftV2;
      expect(historicalBody.schemaVersion).toBe("2");
      expect(historicalBody.version).toBe(1);
      expect(historicalBody.values["strength"]).toBe(12);

      // 7. Neither GET rewrote the historical bytes.
      expect(await readRawR2(v1Key)).toBe(storedV1);

      // 8. Mutate through the live V2 PATCH contract.
      const patch = await worker.fetch(
        request(
          `/v1/character-sheets/sessions/${sessionId}/drafts/${draftId}`,
          accessToken,
          {
            method: "PATCH",
            body: {
              expectedVersion: 1,
              mutation: {
                op: "set_value",
                key: "strength",
                value: 15,
              },
            },
          },
        ),
        { DB: db, SHEET_ARTIFACTS: bucket() },
      );
      expect(patch.status).toBe(200);
      const mutated = (await patch.json()) as CharacterSheetDraftV2;
      expect(mutated.schemaVersion).toBe("2");
      expect(mutated.version).toBe(2);
      expect(mutated.values["strength"]).toBe(15);

      // 9-10. The historical version is untouched; the new version is V2.
      expect(await readRawR2(v1Key)).toBe(storedV1);
      const v2Raw = await readRawR2(getDraftSnapshotKey(sessionId, draftId, 2));
      expect(v2Raw).not.toBeNull();
      expect(
        (JSON.parse(v2Raw!) as { schemaVersion: unknown }).schemaVersion,
      ).toBe("2");
    });
  });
});
