// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharacterWorkshopV2Host } from "./CharacterWorkshopV2Host";

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe("CharacterWorkshopV2Host", () => {
  it("fails closed without a site key", () => {
    const previous = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

    render(<CharacterWorkshopV2Host />);

    expect(
      screen.getByText(
        "Human verification is unavailable right now. Please try again later.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeNull();

    if (previous !== undefined) {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previous;
    }
  });

  it("wires a real widget token into the workshop session attempt", async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
    const captured: { callback: ((token: string) => void) | null } = {
      callback: null,
    };
    window.turnstile = {
      render: vi.fn((_container, options) => {
        captured.callback = options.callback ?? null;
        return "widget-1";
      }),
      reset: vi.fn(),
    };

    render(<CharacterWorkshopV2Host />);
    await waitFor(() => {
      expect(captured.callback).not.toBeNull();
    });
    captured.callback?.("real-token-123");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /How do you want to create your character\?/i,
        }),
      ).toBeTruthy();
    });
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });

  it("surfaces widget expiry as a user-safe error", async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
    const captured: { expired: (() => void) | null } = { expired: null };
    window.turnstile = {
      render: vi.fn((_container, options) => {
        captured.expired = options["expired-callback"] ?? null;
        return "widget-1";
      }),
      reset: vi.fn(),
    };

    render(<CharacterWorkshopV2Host />);
    await waitFor(() => {
      expect(captured.expired).not.toBeNull();
    });
    captured.expired?.();

    await waitFor(() => {
      expect(
        screen.getByText("The verification expired. Please verify again."),
      ).toBeTruthy();
    });
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });
});
