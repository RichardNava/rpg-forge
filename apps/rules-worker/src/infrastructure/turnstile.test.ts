import { describe, expect, it, vi } from "vitest";
import { createTurnstileHumanVerification } from "./turnstile.js";

describe("Turnstile human verification", () => {
  it("accepts the fixed bypass token only when local mode is explicitly enabled", async () => {
    const local = createTurnstileHumanVerification({
      TURNSTILE_MODE: "local",
    });
    await expect(
      local.verify("local-turnstile-bypass", {}),
    ).resolves.toEqual({ kind: "success" });

    const production = createTurnstileHumanVerification({});
    await expect(
      production.verify("local-turnstile-bypass", {}),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("uses the remote verifier when a production secret is configured", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchImpl);
    const verification = createTurnstileHumanVerification({
      TURNSTILE_SECRET: "secret",
    });

    await expect(verification.verify("token", { clientIp: "127.0.0.1" })).resolves.toEqual({
      kind: "success",
    });
    vi.unstubAllGlobals();
  });
});
