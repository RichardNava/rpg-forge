import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { account, session, user, verification } from "./auth";

describe("Better Auth schema", () => {
  it("exposes only the four core authentication tables", () => {
    expect([user, session, account, verification].map(getTableName)).toEqual([
      "user",
      "session",
      "account",
      "verification",
    ]);
  });
});
