"use client";

import type {
  CharacterTypePreference,
  ThreatLevelPreference,
} from "../state/sheet-store-types";
import {
  CHARACTER_TYPE_LABEL,
  CHARACTER_TYPE_OPTIONS,
  THREAT_LEVEL_EXPLANATION,
  THREAT_LEVEL_LABEL,
  THREAT_LEVEL_OPTIONS,
} from "../lib/workshop-preferences";

export interface WorkshopIdentityPatch {
  characterType?: CharacterTypePreference;
  threatLevel?: ThreatLevelPreference | null;
}

interface WorkshopIdentitySelectorProps {
  characterType: CharacterTypePreference;
  threatLevel: ThreatLevelPreference | null;
  disabled: boolean;
  onChange(patch: WorkshopIdentityPatch): void;
}

function handleRoleChange(
  option: CharacterTypePreference,
  onChange: (patch: WorkshopIdentityPatch) => void,
): void {
  if (option === "pc") {
    onChange({ characterType: "pc", threatLevel: null });
  } else {
    onChange({ characterType: "npc" });
  }
}

export function WorkshopIdentitySelector({
  characterType,
  threatLevel,
  disabled,
  onChange,
}: WorkshopIdentitySelectorProps) {
  return (
    <div className="character-workshop__identity" aria-label="Character identity">
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
          {CHARACTER_TYPE_OPTIONS.map((option) => {
            const selected = characterType === option;
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
                aria-label={CHARACTER_TYPE_LABEL[option]}
                title={CHARACTER_TYPE_LABEL[option]}
                onClick={() => handleRoleChange(option, onChange)}
                disabled={disabled}
              >
                {option.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {characterType === "npc" && (
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