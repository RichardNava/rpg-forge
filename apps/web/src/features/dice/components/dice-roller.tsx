"use client";

import { DiceValidationError } from "@repo/dice-engine";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DiceConfigurationDock } from "./dice-configuration-dock";
import { DiceResultDock } from "./dice-result-dock";
import {
  DiceTable3d,
  type DiceRollPresentation,
  type DiceTableRoll,
  type DiceVerificationMismatch,
} from "./dice-table-3d";
import { toDiceBoxRollPlan } from "../lib/dice-box-adapter";
import {
  INITIAL_DICE_CONFIGURATION,
  prepareDiceRoll,
  type DiceRollConfiguration,
  type PreparedDiceRoll,
} from "../lib/dice-roll-config";

type CompletedRoll = {
  mismatch: DiceVerificationMismatch | null;
  presentation: DiceRollPresentation;
  rollId: number;
  roll: PreparedDiceRoll;
};

type RollState =
  | { kind: "configuration" }
  | { kind: "rolling"; roll: PreparedDiceRoll; tableRoll: DiceTableRoll }
  | ({ kind: "result" } & CompletedRoll);

export function DiceRoller() {
  const [configuration, setConfiguration] = useState<DiceRollConfiguration>(
    () => INITIAL_DICE_CONFIGURATION,
  );
  const [rollState, setRollState] = useState<RollState>({
    kind: "configuration",
  });
  const [rollInFlight, setRollInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [configurationFocusRequest, setConfigurationFocusRequest] = useState(0);
  const rollIdRef = useRef(0);
  const rollInFlightRef = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const isRolling = rollState.kind === "rolling" || rollInFlight;
  const displayedRoll =
    rollState.kind === "rolling" || rollState.kind === "result"
      ? rollState.roll
      : null;

  useEffect(() => {
    if (rollState.kind !== "result") return;
    if (rollInFlightRef.current === rollState.rollId) {
      rollInFlightRef.current = null;
      setRollInFlight(false);
    }
  }, [rollState]);

  function updateConfiguration(nextConfiguration: DiceRollConfiguration) {
    setConfiguration(nextConfiguration);
    setError(null);
  }

  function resetConfiguration() {
    if (isRolling) return;
    setConfiguration({
      ...INITIAL_DICE_CONFIGURATION,
      theme: { ...INITIAL_DICE_CONFIGURATION.theme },
    });
    setError(null);
  }

  function beginRoll() {
    if (isRolling || rollInFlightRef.current !== null) return;

    const rollId = ++rollIdRef.current;
    rollInFlightRef.current = rollId;
    setRollInFlight(true);

    try {
      const roll = prepareDiceRoll(configuration);
      const plan = toDiceBoxRollPlan(roll.result, roll.sides);
      const tableRoll: DiceTableRoll = {
        id: rollId,
        plan,
        usesSupported3dDie: roll.usesSupported3dDie,
      };
      setError(null);
      setRollState({ kind: "rolling", roll, tableRoll });
    } catch (caught) {
      if (rollInFlightRef.current === rollId) {
        rollInFlightRef.current = null;
      }
      setRollInFlight(false);
      setRollState({ kind: "configuration" });
      setError(
        caught instanceof DiceValidationError
          ? caught.message
          : "The dice could not be rolled. Check your choices and try again.",
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beginRoll();
  }

  function handleComplete(
    rollId: number,
    presentation: DiceRollPresentation,
    mismatch?: DiceVerificationMismatch,
  ) {
    if (rollInFlightRef.current !== rollId) return;
    setRollState((current) => {
      if (current.kind !== "rolling" || current.tableRoll.id !== rollId) {
        return current;
      }
      return {
        kind: "result",
        mismatch: mismatch ?? null,
        presentation,
        roll: current.roll,
        rollId,
      };
    });
  }

  function returnToConfiguration() {
    setConfigurationFocusRequest((request) => request + 1);
    setRollState({ kind: "configuration" });
  }

  const activeRoll = rollState.kind === "rolling" ? rollState.tableRoll : null;

  return (
    <main className="dice-roller">
      <div className="dice-roller__workspace">
        {rollState.kind === "result" ? (
          <DiceResultDock
            disabled={rollInFlight}
            mismatch={rollState.mismatch}
            onEdit={returnToConfiguration}
            onReroll={beginRoll}
            presentation={rollState.presentation}
            roll={rollState.roll}
            rollId={rollState.rollId}
          />
        ) : (
          <DiceConfigurationDock
            configuration={configuration}
            error={error}
            focusRequest={configurationFocusRequest}
            isRolling={isRolling}
            onChange={updateConfiguration}
            onReset={resetConfiguration}
            onRoll={handleSubmit}
          />
        )}
        <DiceTable3d
          activeRoll={activeRoll}
          onComplete={handleComplete}
          reduceMotion={reduceMotion}
          successCount={displayedRoll?.successCount ?? null}
          theme={configuration.theme}
        />
        <p className="dice-roller__session-note">
          Local and temporary. Nothing is saved.
        </p>
      </div>
    </main>
  );
}
