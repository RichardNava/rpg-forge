"use client";

import { useCallback, useState } from "react";
import {
  CharacterWorkshopV2,
  type SheetV2SessionTokenProvider,
} from "./CharacterWorkshopV2";
import { TurnstileWidget } from "./TurnstileWidget";

/**
 * Production composition for the V2 workshop: it connects a real Cloudflare
 * Turnstile widget to the workshop's session-token boundary.
 *
 * Each token is single-use — it is consumed when a session attempt starts and
 * the widget is reset so the next attempt requires a fresh verification. A
 * missing site key, an empty token, or the isolated-development bypass string
 * in remote mode all fail closed with a user-safe error instead of a session.
 */
export function CharacterWorkshopV2Host() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const sessionTokenProvider: SheetV2SessionTokenProvider =
    useCallback(async () => {
      const current = token;
      setToken(null);
      setResetSignal((signal) => signal + 1);
      if (current === null || current === "") {
        throw new Error(
          "Human verification is required before starting a session.",
        );
      }
      return current;
    }, [token]);

  if (siteKey === undefined || siteKey === "") {
    return (
      <div className="character-workshop__workspace">
        <p className="character-workshop__alert" role="alert">
          Human verification is unavailable right now. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="character-workshop__workspace">
      <TurnstileWidget
        siteKey={siteKey}
        resetSignal={resetSignal}
        onToken={(fresh) => {
          setToken(fresh);
          setWidgetError(null);
        }}
        onError={setWidgetError}
      />
      {widgetError !== null && (
        <p className="character-workshop__alert" role="alert">
          {widgetError}
        </p>
      )}
      <CharacterWorkshopV2 sessionTokenProvider={sessionTokenProvider} />
    </div>
  );
}
