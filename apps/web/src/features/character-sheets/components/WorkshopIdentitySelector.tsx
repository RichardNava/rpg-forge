"use client";

import type {
  ThreatLevelPreference,
} from "../state/sheet-workshop-types";
import {
  THREAT_LEVEL_EXPLANATION,
  THREAT_LEVEL_LABEL,
  THREAT_LEVEL_OPTIONS,
} from "../lib/workshop-preferences";

export interface WorkshopIdentityPatch {
  mode?: "pc" | "npc";
  threatLevel?: ThreatLevelPreference | null;
}

interface WorkshopIdentitySelectorProps {
  mode: "pc" | "npc";
  threatLevel: ThreatLevelPreference | null;
  disabled: boolean;
  onChange(patch: WorkshopIdentityPatch): void;
}

export function WorkshopIdentitySelector({
  mode,
  threatLevel,
  disabled,
  onChange,
}: WorkshopIdentitySelectorProps) {
  return (
    <div
      className="character-workshop__identity"
      aria-label="Character identity"
    >
      <div className="character-workshop__identity-field">
        <span
          className="character-workshop__identity-label"
          id="workshop-identity-role-label"
        >
          Role
        </span>
        <div
          className="character-workshop__identity-segment"
          role="group"
          aria-labelledby="workshop-identity-role-label"
        >
          {(["pc", "npc"] as const).map((option) => {
            const selected = mode === option;
            return (
              <button
                key={option}
                type="button"
                className={
                  selected
                    ? "character-workshop__identity-option character-workshop__identity-option--selected"
                    : "character-workshop__identity-option"
                }
                aria-pressed={selected}
                aria-label={option === "pc" ? "Player Character" : "Non-Player Character"}
                title={option === "pc" ? "Player Character" : "Non-Player Character"}
                onClick={() => !disabled && onChange({ mode: option })}
                disabled={disabled}
              >
                {option.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "npc" && (
        <div className="character-workshop__identity-field">
          <span
            className="character-workshop__identity-label"
            id="workshop-identity-threat-label"
          >
            Threat
          </span>
          <div
            className="character-workshop__identity-segment"
            role="group"
            aria-labelledby="workshop-identity-threat-label"
          >
            {THREAT_LEVEL_OPTIONS.map((option) => {
              const selected = threatLevel === option;
              return (
                <button
                  key={option}
                  type="button"
                  className={
                    selected
                      ? "character-workshop__identity-option character-workshop__identity-option--selected"
                      : "character-workshop__identity-option"
                  }
                  aria-pressed={selected}
                  title={THREAT_LEVEL_EXPLANATION[option]}
                  onClick={() =>
                    onChange({
                      threatLevel: selected ? null : option,
                    })
                  }
                  disabled={disabled}
                >
                  {THREAT_LEVEL_LABEL[option]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
