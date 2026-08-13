import { describe, expect, it } from "vitest";
import {
  AuthenticationRequiredError,
  requireSessionValue,
} from "./session-guard";

describe("requireSessionValue", () => {
  it("returns a valid session", () => {
    expect(requireSessionValue({ user: { id: "user-1" } })).toEqual({
      user: { id: "user-1" },
    });
  });

  it("rejects missing sessions", () => {
    expect(() => requireSessionValue(null)).toThrow(
      AuthenticationRequiredError,
    );
  });
});
