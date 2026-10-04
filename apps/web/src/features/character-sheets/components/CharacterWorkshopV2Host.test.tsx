// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharacterWorkshopV2Host } from "./CharacterWorkshopV2Host";

const BACKEND_ENV = "NEXT_PUBLIC_CHARACTER_SHEET_BACKEND";
const SITE_KEY_ENV = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";

afterEach(() => {
  cleanup();
  delete window.turnstile;
  delete process.env[BACKEND_ENV];
  delete process.env[SITE_KEY_ENV];
});

function renderRemoteHost() {
  process.env[BACKEND_ENV] = "remote";
  render(<CharacterWorkshopV2Host />);
}

describe("CharacterWorkshopV2Host", () => {
  it("fails closed without a site key in remote mode", () => {
    renderRemoteHost();

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
  });

  it("wires a real widget token into the workshop session attempt in remote mode", async () => {
    process.env[SITE_KEY_ENV] = "test-site-key";
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

    renderRemoteHost();
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
  });

  it("surfaces widget expiry as a user-safe error in remote mode", async () => {
    process.env[SITE_KEY_ENV] = "test-site-key";
    const captured: { expired: (() => void) | null } = { expired: null };
    window.turnstile = {
      render: vi.fn((_container, options) => {
        captured.expired = options["expired-callback"] ?? null;
        return "widget-1";
      }),
      reset: vi.fn(),
    };

    renderRemoteHost();
    await waitFor(() => {
      expect(captured.expired).not.toBeNull();
    });
    captured.expired?.();

    await waitFor(() => {
      expect(
        screen.getByText("The verification expired. Please verify again."),
      ).toBeTruthy();
    });
  });

  it("renders the workshop without a site key in explicit local mode", () => {
    process.env[BACKEND_ENV] = "local";

    render(<CharacterWorkshopV2Host />);

    expect(
      screen.getByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "Human verification is unavailable right now. Please try again later.",
      ),
    ).toBeNull();
  });

  it("never loads or renders Turnstile in explicit local mode", () => {
    process.env[BACKEND_ENV] = "local";
    process.env[SITE_KEY_ENV] = "test-site-key";
    window.turnstile = {
      render: vi.fn(() => "widget-1"),
      reset: vi.fn(),
    };

    render(<CharacterWorkshopV2Host />);

    expect(
      screen.getByRole("heading", {
        name: /How do you want to create your character\?/i,
      }),
    ).toBeTruthy();
    expect(window.turnstile.render).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="turnstile"]')).toBeNull();
    expect(
      document.querySelector('[aria-label="Human verification"]'),
    ).toBeNull();
  });
});
