import { ChevronDown, Dices, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";

import { DiceThemeControls } from "./dice-theme-controls";
import {
  clamp,
  formatExpression,
  MAX_DICE_PER_ROLL,
  MAX_MODIFIER,
  MIN_MODIFIER,
  STANDARD_DICE_SIDES,
  type DiceRollConfiguration,
  type DiceRollMode,
} from "../lib/dice-roll-config";

type DiceConfigurationDockProps = {
  configuration: DiceRollConfiguration;
  error: string | null;
  focusRequest: number;
  isRolling: boolean;
  onChange: (configuration: DiceRollConfiguration) => void;
  onReset: () => void;
  onRoll: (event: FormEvent<HTMLFormElement>) => void;
};

const ROLL_MODES: { value: DiceRollMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "advantage", label: "Advantage" },
  { value: "disadvantage", label: "Disadvantage" },
];

function numericValue(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const next = Number(value);
  return Number.isFinite(next)
    ? clamp(Math.trunc(next), minimum, maximum)
    : fallback;
}

export function DiceConfigurationDock({
  configuration,
  error,
  focusRequest,
  isRolling,
  onChange,
  onReset,
  onRoll,
}: DiceConfigurationDockProps) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const notationInputRef = useRef<HTMLInputElement>(null);
  const expression = configuration.notationOpen
    ? configuration.notation
    : formatExpression(
        configuration.rollMode === "normal" ? configuration.count : 2,
        configuration.rollMode === "normal" ? configuration.sides : 20,
        configuration.modifier,
      );
  const successThreshold = configuration.successThreshold?.toString() ?? "";

  useEffect(() => {
    if (!error) return;
    if (configuration.notationOpen) {
      notationInputRef.current?.focus();
      return;
    }
    errorRef.current?.focus();
  }, [configuration.notationOpen, error]);

  useEffect(() => {
    if (focusRequest > 0) headingRef.current?.focus();
  }, [focusRequest]);

  function update<K extends keyof DiceRollConfiguration>(
    key: K,
    value: DiceRollConfiguration[K],
  ) {
    onChange({ ...configuration, [key]: value });
  }

  return (
    <section
      aria-labelledby="dice-title"
      className="dice-dock dice-dock--configuration"
    >
      <div className="dice-dock__intro">
        <p className="dice-kicker">RPG Forge</p>
        <h1 id="dice-title" ref={headingRef} tabIndex={-1}>
          Dice Roller
        </h1>
        <p>Choose the terms, then cast onto the table. Rolls stay local.</p>
      </div>
      <form
        aria-describedby={error ? "dice-error" : undefined}
        className="dice-configuration-form"
        onSubmit={onRoll}
      >
        <div className="dice-configuration-form__core">
          <fieldset className="dice-fieldset dice-die-picker">
            <legend>Die</legend>
            <div aria-label="Choose a die" role="group">
              {STANDARD_DICE_SIDES.map((sides) => (
                <button
                  aria-pressed={configuration.sides === sides}
                  className={configuration.sides === sides ? "is-selected" : ""}
                  disabled={isRolling}
                  key={sides}
                  onClick={() =>
                    onChange({
                      ...configuration,
                      sides,
                      rollMode:
                        sides === 20 ? configuration.rollMode : "normal",
                    })
                  }
                  type="button"
                >
                  d{sides}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="dice-field">
            <label htmlFor="dice-count">Dice</label>
            <input
              aria-describedby="dice-count-help"
              disabled={isRolling || configuration.notationOpen}
              id="dice-count"
              inputMode="numeric"
              max={MAX_DICE_PER_ROLL}
              min={1}
              onChange={(event) =>
                update(
                  "count",
                  numericValue(event.target.value, 1, 1, MAX_DICE_PER_ROLL),
                )
              }
              type="number"
              value={configuration.count}
            />
            <small id="dice-count-help">1–{MAX_DICE_PER_ROLL}</small>
          </div>
          <div className="dice-field">
            <label htmlFor="dice-modifier">Modifier</label>
            <input
              disabled={isRolling || configuration.notationOpen}
              id="dice-modifier"
              inputMode="numeric"
              max={MAX_MODIFIER}
              min={MIN_MODIFIER}
              onChange={(event) =>
                update(
                  "modifier",
                  numericValue(
                    event.target.value,
                    0,
                    MIN_MODIFIER,
                    MAX_MODIFIER,
                  ),
                )
              }
              type="number"
              value={configuration.modifier}
            />
          </div>
          <div className="dice-field">
            <label htmlFor="dice-successes">Success threshold</label>
            <input
              aria-describedby="dice-successes-help"
              disabled={isRolling}
              id="dice-successes"
              inputMode="numeric"
              min={1}
              onChange={(event) => {
                const value = event.target.value;
                update(
                  "successThreshold",
                  value === "" || !Number.isSafeInteger(Number(value))
                    ? null
                    : Number(value),
                );
              }}
              placeholder="—"
              type="number"
              value={successThreshold}
            />
            <small id="dice-successes-help">
              Each kept die plus the roll modifier counts at or above this
              value. Use a value above 0 and below the number of die faces.
            </small>
          </div>
        </div>
        {configuration.sides === 20 && !configuration.notationOpen ? (
          <fieldset className="dice-fieldset dice-roll-mode">
            <legend>d20 roll</legend>
            <div role="group" aria-label="d20 roll mode">
              {ROLL_MODES.map((mode) => (
                <button
                  aria-pressed={configuration.rollMode === mode.value}
                  className={
                    configuration.rollMode === mode.value ? "is-selected" : ""
                  }
                  disabled={isRolling}
                  key={mode.value}
                  onClick={() => update("rollMode", mode.value)}
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="dice-configuration-form__actions">
          <p className="dice-expression" translate="no">
            <span>Expression</span> {expression}
          </p>
          <button
            aria-controls="dice-advanced-notation"
            aria-expanded={configuration.notationOpen}
            className="dice-disclosure"
            disabled={isRolling}
            onClick={() => update("notationOpen", !configuration.notationOpen)}
            type="button"
          >
            Advanced notation <ChevronDown aria-hidden="true" />
          </button>
          <button
            aria-controls="dice-visual-options"
            aria-expanded={configuration.visualOptionsOpen}
            className="dice-disclosure"
            disabled={isRolling}
            onClick={() =>
              update("visualOptionsOpen", !configuration.visualOptionsOpen)
            }
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" /> Visual settings
            <ChevronDown aria-hidden="true" />
          </button>
          <button
            className="dice-secondary-button"
            disabled={isRolling}
            onClick={onReset}
            type="button"
          >
            <RotateCcw aria-hidden="true" /> Reset settings
          </button>
          <button
            className="dice-roll-button"
            disabled={isRolling}
            type="submit"
          >
            <Dices aria-hidden="true" />
            {isRolling ? "Dice settling…" : "Roll dice"}
          </button>
        </div>
        {configuration.notationOpen ? (
          <div className="dice-advanced-panel" id="dice-advanced-notation">
            <div className="dice-field">
              <label htmlFor="dice-notation">Advanced notation</label>
              <input
                aria-describedby={
                  error ? "dice-notation-help dice-error" : "dice-notation-help"
                }
                aria-invalid={error ? true : undefined}
                disabled={isRolling}
                id="dice-notation"
                onChange={(event) => update("notation", event.target.value)}
                placeholder="e.g. 2d6+3"
                ref={notationInputRef}
                spellCheck={false}
                type="text"
                value={configuration.notation}
              />
              <small id="dice-notation-help">Examples: d20, 2d6, 2d6+3</small>
            </div>
          </div>
        ) : null}
        {configuration.visualOptionsOpen ? (
          <div className="dice-advanced-panel" id="dice-visual-options">
            <DiceThemeControls
              disabled={isRolling}
              onChange={(theme) => update("theme", theme)}
              theme={configuration.theme}
            />
          </div>
        ) : null}
        {error ? (
          <p
            className="dice-error"
            id="dice-error"
            ref={errorRef}
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
