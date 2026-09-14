import { describe, expect, it } from "vitest";
import { readRulesWorkerConfiguration } from "./env.server";

describe("readRulesWorkerConfiguration", () => {
  it("rejects missing server-side configuration", () => {
    expect(() => readRulesWorkerConfiguration({})).toThrow(
      "RULES_WORKER_URL is not configured",
    );
  });

  it("rejects an empty server-side configuration value", () => {
    expect(() =>
      readRulesWorkerConfiguration({ RULES_WORKER_URL: "  " }),
    ).toThrow("RULES_WORKER_URL is not configured");
  });

  it("returns the configured rules-worker URL", () => {
    expect(
      readRulesWorkerConfiguration({
        RULES_WORKER_URL: "https://rules-worker.test",
      }),
    ).toEqual({ rulesWorkerUrl: "https://rules-worker.test" });
  });
});
