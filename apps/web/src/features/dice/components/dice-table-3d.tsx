"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  extractDiceBoxFaces,
  type DiceBoxRollPlan,
} from "../lib/dice-box-adapter";
import {
  applyDiceBoxTheme,
  type DiceBoxThemeBridge,
} from "../lib/dice-box-bridge";
import { type DiceTheme } from "../lib/dice-theme-options";

const DICE_BOX_ASSET_PATH = "/dice-box-assets/";
const DICE_BOX_BASE_SCALE = 75;
const DICE_BOX_INITIALIZATION_TIMEOUT_MS = 15_000;
const DICE_BOX_ROLL_TIMEOUT_MS = 20_000;

class DiceBoxTimeoutError extends Error {
  constructor(operation: "initialization" | "roll") {
    super(`DiceBox ${operation} timed out.`);
    this.name = "DiceBoxTimeoutError";
  }
}

function withDiceBoxTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: "initialization" | "roll",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new DiceBoxTimeoutError(operationName)),
      timeoutMs,
    );
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function waitForNextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

type DiceBoxInstance = DiceBoxThemeBridge & {
  clearDice: () => void;
  initialize: () => Promise<void>;
  roll: (notation: string) => Promise<unknown>;
  setDimensions: (dimensions: { x: number; y: number }) => void;
};

export type DiceTableRoll = {
  id: number;
  plan: DiceBoxRollPlan;
  usesSupported3dDie: boolean;
};

export type DiceRollPresentation =
  "physical" | "fallback" | "reduced-motion" | "unverified";

export type DiceVerificationMismatch = {
  expectedValues: number[];
  presentationToken: number;
  returnedValues: number[] | null;
  rollId: number;
};

type DiceTable3dProps = {
  activeRoll: DiceTableRoll | null;
  reduceMotion: boolean;
  successCount: number | null;
  theme: DiceTheme;
  onComplete: (
    rollId: number,
    presentation: DiceRollPresentation,
    mismatch?: DiceVerificationMismatch,
  ) => void;
};

/**
 * DiceBox 0.0.12 has no disposal API. This component intentionally owns one
 * instance for its lifetime and applies visual changes through its bridge.
 */
export function DiceTable3d({
  activeRoll,
  reduceMotion,
  successCount,
  theme,
  onComplete,
}: DiceTable3dProps) {
  const reactId = useId().replaceAll(":", "");
  const trayId = `dice-table-${reactId}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const diceBoxRef = useRef<DiceBoxInstance | null>(null);
  const diceBoxPhysicsInFlightRef = useRef(false);
  const diceBoxWorkRef = useRef<Promise<void> | null>(null);
  const pendingResizeRef = useRef(false);
  const presentationTokenRef = useRef(0);
  const callbacksRef = useRef({ onComplete });
  const reduceMotionRef = useRef(reduceMotion);
  const synchronizeDimensionsRef = useRef<(() => void) | null>(null);
  const themeRef = useRef(theme);
  const [rendererState, setRendererState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [presentationFailure, setPresentationFailure] = useState(false);

  useEffect(() => {
    callbacksRef.current = { onComplete };
    reduceMotionRef.current = reduceMotion;
    themeRef.current = theme;
  });

  useEffect(() => {
    let active = true;
    const host = hostRef.current;
    if (!host) return;

    void import("@3d-dice/dice-box-threejs")
      .then(async ({ default: DiceBox }) => {
        if (!active) return;

        const initialTheme = themeRef.current;
        const diceBox = new DiceBox(`#${trayId}`, {
          assetPath: DICE_BOX_ASSET_PATH,
          baseScale: DICE_BOX_BASE_SCALE,
          sounds: true,
          theme_colorset: initialTheme.colorset,
          theme_texture: initialTheme.texture,
          theme_material: initialTheme.material,
          theme_surface: "green-felt",
        });
        const initialization = diceBox.initialize();
        try {
          await withDiceBoxTimeout(
            initialization,
            DICE_BOX_INITIALIZATION_TIMEOUT_MS,
            "initialization",
          );
        } catch (error) {
          if (error instanceof DiceBoxTimeoutError) {
            void initialization.then(
              () => {
                diceBox.clearDice();
                host.replaceChildren();
              },
              () => undefined,
            );
          }
          throw error;
        }

        if (!active) {
          diceBox.clearDice();
          host.replaceChildren();
          return;
        }

        diceBoxRef.current = diceBox;
        setRendererState("ready");
      })
      .catch(() => {
        if (active) setRendererState("unavailable");
      });

    return () => {
      active = false;
      diceBoxRef.current?.clearDice();
      diceBoxRef.current = null;
      host.replaceChildren();
    };
  }, [trayId]);

  useEffect(() => {
    const host = hostRef.current;
    const diceBox = diceBoxRef.current;
    if (!host || !diceBox || typeof ResizeObserver === "undefined") return;

    const synchronizeDimensions = () => {
      diceBox.setDimensions({ x: host.clientWidth, y: host.clientHeight });
    };
    const resize = () => {
      if (diceBoxPhysicsInFlightRef.current) {
        pendingResizeRef.current = true;
        return;
      }
      synchronizeDimensions();
    };
    synchronizeDimensionsRef.current = synchronizeDimensions;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      observer.disconnect();
      if (synchronizeDimensionsRef.current === synchronizeDimensions) {
        synchronizeDimensionsRef.current = null;
      }
    };
  }, [rendererState]);

  useEffect(() => {
    const presentationToken = ++presentationTokenRef.current;
    let active = true;
    const isCurrentPresentation = () =>
      active && presentationTokenRef.current === presentationToken;
    const invalidatePresentation = () => {
      active = false;
      if (presentationTokenRef.current === presentationToken) {
        presentationTokenRef.current += 1;
      }
    };

    if (!activeRoll) return invalidatePresentation;
    if (reduceMotionRef.current) {
      callbacksRef.current.onComplete(activeRoll.id, "reduced-motion");
      return invalidatePresentation;
    }
    if (!activeRoll.usesSupported3dDie || rendererState === "unavailable") {
      callbacksRef.current.onComplete(activeRoll.id, "fallback");
      return invalidatePresentation;
    }
    if (rendererState !== "ready" || !diceBoxRef.current) {
      return invalidatePresentation;
    }

    const diceBox = diceBoxRef.current;
    const visualTheme = themeRef.current;

    void (async () => {
      const previousWork = diceBoxWorkRef.current;
      if (previousWork) {
        await previousWork;
        if (!isCurrentPresentation()) return;
      }

      setPresentationFailure(false);
      const work = (async () => {
        try {
          await applyDiceBoxTheme(diceBox, visualTheme);
          if (!isCurrentPresentation()) return;

          // Let the Result Dock -> Configuration Dock layout settle before
          // DiceBox creates its next physics world.
          await waitForNextAnimationFrame();
          if (!isCurrentPresentation()) return;
          synchronizeDimensionsRef.current?.();

          diceBoxPhysicsInFlightRef.current = true;
          let response: unknown;
          try {
            response = await withDiceBoxTimeout(
              diceBox.roll(activeRoll.plan.notation),
              DICE_BOX_ROLL_TIMEOUT_MS,
              "roll",
            );
          } finally {
            diceBoxPhysicsInFlightRef.current = false;
            if (pendingResizeRef.current) {
              pendingResizeRef.current = false;
              synchronizeDimensionsRef.current?.();
            }
          }
          if (!isCurrentPresentation()) return;

          const returnedValues = extractDiceBoxFaces(response);
          if (
            returnedValues !== null &&
            returnedValues.length === activeRoll.plan.expectedValues.length &&
            returnedValues.every(
              (value, index) => value === activeRoll.plan.expectedValues[index],
            )
          ) {
            callbacksRef.current.onComplete(activeRoll.id, "physical");
            return;
          }

          const mismatch =
            process.env.NODE_ENV === "development"
              ? {
                  expectedValues: activeRoll.plan.expectedValues,
                  presentationToken,
                  returnedValues,
                  rollId: activeRoll.id,
                }
              : undefined;
          if (mismatch) {
            console.warn("[dice] 3D face verification failed.", {
              ...mismatch,
              notation: activeRoll.plan.notation,
              visualDice: activeRoll.plan.visualDice,
            });
          }
          callbacksRef.current.onComplete(
            activeRoll.id,
            "unverified",
            mismatch,
          );
        } catch (error) {
          if (error instanceof DiceBoxTimeoutError) {
            try {
              diceBox.clearDice();
            } catch {
              // The engine result is still returned through the fallback below.
            }
          }
          if (!isCurrentPresentation()) return;
          setPresentationFailure(true);
          callbacksRef.current.onComplete(activeRoll.id, "fallback");
        }
      })();
      diceBoxWorkRef.current = work;

      try {
        await work;
      } finally {
        if (diceBoxWorkRef.current === work) {
          diceBoxWorkRef.current = null;
        }
      }
    })();

    return invalidatePresentation;
  }, [activeRoll, rendererState]);

  const tableStatus =
    rendererState === "loading"
      ? "Preparing the 3D dice table."
      : rendererState === "unavailable" || presentationFailure
        ? "3D visualization is unavailable. Results remain accessible below."
        : activeRoll
          ? "Dice are settling on the table."
          : "The dice table is ready.";

  return (
    <section aria-label="3D dice table" className="dice-table-shell">
      <div className="dice-table-frame">
        <div className="dice-table-felt">
          <div
            aria-hidden="true"
            className="dice-table-corner dice-table-corner--top"
          />
          <div
            aria-hidden="true"
            className="dice-table-canvas"
            id={trayId}
            ref={hostRef}
          />
          {successCount !== null ? (
            <p className="dice-success-indicator">
              <span>Total successes</span>
              <strong>{successCount}</strong>
            </p>
          ) : null}
          {rendererState === "unavailable" || presentationFailure ? (
            <p className="dice-table-fallback">
              3D visualization is unavailable in this browser.
            </p>
          ) : null}
        </div>
      </div>
      <p className="dice-table-status">{tableStatus}</p>
    </section>
  );
}

export {
  DICE_BOX_BASE_SCALE,
  DICE_BOX_INITIALIZATION_TIMEOUT_MS,
  DICE_BOX_ROLL_TIMEOUT_MS,
};
