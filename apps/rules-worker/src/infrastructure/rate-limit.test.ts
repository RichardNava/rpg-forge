import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../test/fakes.js";
import { type Env } from "../env.js";
import { createRateLimitPort } from "./rate-limit.js";

function fixedEnv(partial: Partial<Env> = {}): Env {
  return { DB: {} as D1Database, ...partial };
}

function fixedClock() {
  return new FakeClock("2026-09-07T00:00:00.000Z");
}

describe("createRateLimitPort", () => {
  it("uses the Cloudflare binding adapter when RATE_LIMITER is present", async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({
      success: key !== "blocked",
    }));
    const binding = { limit };
    const port = createRateLimitPort(
      fixedEnv({ RATE_LIMITER: binding }),
      fixedClock(),
    );
    await expect(port.consume("a")).resolves.toEqual({ kind: "allowed" });
    await expect(port.consume("blocked")).resolves.toEqual({ kind: "denied" });
    await expect(port.consume("a")).resolves.toEqual({ kind: "allowed" });
    expect(limit).toHaveBeenCalledTimes(3);
  });

  it("returns unavailable when the binding call throws", async () => {
    const binding = {
      async limit(): Promise<{ success: boolean }> {
        throw new Error("binding failure");
      },
    };
    const port = createRateLimitPort(
      fixedEnv({ RATE_LIMITER: binding }),
      fixedClock(),
    );
    await expect(port.consume("a")).resolves.toEqual({ kind: "unavailable" });
  });

  it("allows the in-memory limiter only in explicit local mode", async () => {
    const port = createRateLimitPort(
      fixedEnv({ RATE_LIMIT_MODE: "local" }),
      fixedClock(),
    );
    for (let i = 0; i < 20; i++) {
      await expect(port.consume("ip")).resolves.toEqual({ kind: "allowed" });
    }
    await expect(port.consume("ip")).resolves.toEqual({ kind: "denied" });
  });

  it("fails closed in explicit production mode when the binding is absent", async () => {
    const port = createRateLimitPort(
      fixedEnv({ RATE_LIMIT_MODE: "production" }),
      fixedClock(),
    );
    await expect(port.consume("ip")).resolves.toEqual({ kind: "unavailable" });
  });

  it("fails closed by default when the environment is unspecified", async () => {
    const port = createRateLimitPort(fixedEnv(), fixedClock());
    await expect(port.consume("ip")).resolves.toEqual({ kind: "unavailable" });
  });

  it("never routes a missing production binding to the in-memory limiter", async () => {
    const port = createRateLimitPort(fixedEnv(), fixedClock());
    await expect(port.consume("ip")).resolves.toEqual({ kind: "unavailable" });
    await expect(port.consume("ip")).resolves.toEqual({ kind: "unavailable" });
  });
});
