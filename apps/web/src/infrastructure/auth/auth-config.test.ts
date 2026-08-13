import { describe, expect, it } from "vitest";
import { getAuthConfiguration } from "./auth-config";

describe("getAuthConfiguration", () => {
  it("rejects incomplete local configuration without exposing values", () => {
    expect(() =>
      getAuthConfiguration({ BETTER_AUTH_SECRET: "secret" }),
    ).toThrow("Authentication is not configured");
  });

  it("returns only the required Better Auth and provider settings", () => {
    expect(
      getAuthConfiguration({
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({
      secret: "secret",
      baseURL: "http://localhost:3000",
      googleClientId: "client-id",
      googleClientSecret: "client-secret",
    });
  });
});
