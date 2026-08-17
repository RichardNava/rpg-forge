import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PreparedDiceRoll } from "../lib/dice-roll-config";
import type { DiceVerificationMismatch } from "./dice-table-3d";

type DiceResultDockProps = {
  disabled: boolean;
  mismatch: DiceVerificationMismatch | null;
  presentation: "physical" | "fallback" | "reduced-motion" | "unverified";
  roll: PreparedDiceRoll;
  rollId: number;
  onEdit: () => void;
  onReroll: () => void;
};

function formatModifier(modifier: number) {
  return modifier > 0 ? `+${modifier}` : `${modifier}`;
}

function formatFaces(values: number[] | null) {
  return values?.join(" · ") ?? "Unavailable";
}

export function DiceResultDock({
  disabled,
  mismatch,
  presentation,
  roll,
  rollId,
  onEdit,
  onReroll,
}: DiceResultDockProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasDiscardedDice = roll.result.discarded.length > 0;
  const remainingKept = new Map<number, number>();
  for (const value of roll.result.kept) {
    remainingKept.set(value, (remainingKept.get(value) ?? 0) + 1);
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, [rollId]);

  return (
    <section
      aria-labelledby="dice-result-title"
      className="dice-dock dice-dock--result"
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        className="dice-result-summary"
      >
        <div className="dice-result-summary__chronicle">
          <p className="dice-kicker">Roll Chronicle</p>
          <h1 id="dice-result-title" ref={headingRef} tabIndex={-1}>
            Resolved Roll
          </h1>
        </div>
        <dl className="dice-result-summary__details">
          <div>
            <dt>Expression</dt>
            <dd translate="no">{roll.expression}</dd>
          </div>
          <div>
            <dt>Dice</dt>
            <dd className="dice-result-summary__dice" translate="no">
              {roll.result.dice.map((value, index) => {
                const keptCount = remainingKept.get(value) ?? 0;
                const isDiscarded = hasDiscardedDice && keptCount === 0;
                if (keptCount > 0) {
                  remainingKept.set(value, keptCount - 1);
                }
                return (
                  <span
                    aria-label={
                      isDiscarded ? `${value}, set aside` : `${value}, kept`
                    }
                    className={isDiscarded ? "is-discarded" : undefined}
                    key={`${value}-${index}`}
                  >
                    {value}
                  </span>
                );
              })}
            </dd>
          </div>
          {roll.result.modifier !== 0 ? (
            <div>
              <dt>Modifier</dt>
              <dd translate="no">{formatModifier(roll.result.modifier)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="dice-result-summary__totals">
          <div className="dice-result-summary__total">
            <span>Total</span>
            <strong>{roll.result.total}</strong>
          </div>
          {roll.successCount !== null ? (
            <div className="dice-result-summary__successes">
              <span>Successes</span>
              <strong>{roll.successCount}</strong>
            </div>
          ) : null}
        </div>
      </div>
      <div className="dice-result-actions">
        <div>
          {presentation === "fallback" ? (
            <p className="dice-result-actions__notice">
              {roll.usesSupported3dDie
                ? "3D visualization was unavailable. The engine result is shown above."
                : "3D visualization is limited to standard dice. The engine result is shown above."}
            </p>
          ) : presentation === "unverified" ? (
            <p className="dice-result-actions__notice">
              3D visualization could not be verified. The engine result is shown
              above.
            </p>
          ) : presentation === "reduced-motion" ? (
            <p className="dice-result-actions__notice">
              Physics animation was skipped for reduced motion.
            </p>
          ) : null}
          {mismatch ? (
            <aside
              aria-label="3D verification mismatch"
              className="dice-result-actions__notice"
            >
              <strong>3D VERIFICATION MISMATCH</strong>
              <p>Expected: {formatFaces(mismatch.expectedValues)}</p>
              <p>DiceBox returned: {formatFaces(mismatch.returnedValues)}</p>
              <p>Roll ID: {mismatch.rollId}</p>
              <p>Presentation token: {mismatch.presentationToken}</p>
              <p>
                Compare these values with the faces physically visible on the
                dice.
              </p>
            </aside>
          ) : null}
        </div>
        <div className="dice-result-actions__buttons">
          <button
            className="dice-secondary-button"
            disabled={disabled}
            onClick={onEdit}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" /> Modify roll
          </button>
          <button
            className="dice-roll-button"
            disabled={disabled}
            onClick={onReroll}
            type="button"
          >
            <RotateCcw aria-hidden="true" /> Reroll
          </button>
        </div>
      </div>
    </section>
  );
}
