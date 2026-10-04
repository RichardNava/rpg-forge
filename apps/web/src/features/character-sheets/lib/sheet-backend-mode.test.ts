import { describe, expect, it } from "vitest";
import { resolveSheetBackendMode } from "./sheet-backend-mode";

describe("resolveSheetBackendMode", () => {
  it("resolves explicit local mode", () => {
    expect(
      resolveSheetBackendMode({
        NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: "local",
        NODE_ENV: "production",
      }),
    ).toBe("local");
  });

  it("resolves explicit remote mode", () => {
    expect(
      resolveSheetBackendMode({
        NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: "remote",
        NODE_ENV: "test",
      }),
    ).toBe("remote");
  });

  it("fails closed to remote for unknown or blank values", () => {
    for (const value of ["", "  ", "staging", "LOCALHOST", "production"]) {
      expect(
        resolveSheetBackendMode({
          NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: value,
          NODE_ENV: "test",
        }),
      ).toBe("remote");
    }
  });

  it("trims and lowercases before matching", () => {
    expect(
      resolveSheetBackendMode({
        NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: "  LOCAL  ",
        NODE_ENV: "production",
      }),
    ).toBe("local");
    expect(
      resolveSheetBackendMode({
        NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: "Remote ",
        NODE_ENV: "test",
      }),
    ).toBe("remote");
  });

  it("defaults to remote outside tests", () => {
    expect(resolveSheetBackendMode({ NODE_ENV: "production" })).toBe("remote");
    expect(resolveSheetBackendMode({ NODE_ENV: "development" })).toBe("remote");
  });

  it("defaults to local under NODE_ENV=test", () => {
    expect(resolveSheetBackendMode({ NODE_ENV: "test" })).toBe("local");
  });
});
