"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ): string;
      reset(widgetId?: string): void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

let scriptLoad: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window !== "undefined" && window.turnstile !== undefined) {
    return Promise.resolve();
  }
  if (scriptLoad !== null) {
    return scriptLoad;
  }
  scriptLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("The human verification script failed to load."));
    document.head.appendChild(script);
  });
  return scriptLoad;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Increment to reset the widget so a fresh token is required. */
  resetSignal: number;
  onToken(token: string): void;
  onError(message: string): void;
}

/**
 * Narrow Cloudflare Turnstile widget. It only surfaces fresh human-verification
 * tokens; verification itself stays server-side in the Worker. No secret ever
 * reaches the client — only the public site key is used here.
 */
export function TurnstileWidget({
  siteKey,
  resetSignal,
  onToken,
  onError,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const handlersRef = useRef({ onToken, onError });
  useEffect(() => {
    handlersRef.current = { onToken, onError };
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript().then(
      () => {
        if (cancelled || containerRef.current === null) return;
        if (window.turnstile === undefined) {
          handlersRef.current.onError(
            "Human verification is unavailable right now.",
          );
          return;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => handlersRef.current.onToken(token),
          "error-callback": () =>
            handlersRef.current.onError(
              "Human verification failed. Please try again.",
            ),
          "expired-callback": () =>
            handlersRef.current.onError(
              "The verification expired. Please verify again.",
            ),
        });
      },
      () => {
        if (!cancelled) {
          handlersRef.current.onError(
            "Human verification is unavailable right now.",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0) {
      window.turnstile?.reset(widgetIdRef.current ?? undefined);
    }
  }, [resetSignal]);

  return <div ref={containerRef} aria-label="Human verification" />;
}
