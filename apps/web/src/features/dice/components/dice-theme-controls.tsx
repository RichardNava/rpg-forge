import { Palette, Volume2, VolumeX } from "lucide-react";

import {
  colorForColorset,
  DICE_COLORSETS,
  DICE_MATERIALS,
  DICE_TEXTURES,
  type DiceTheme,
} from "../lib/dice-theme-options";

type DiceThemeControlsProps = {
  disabled: boolean;
  theme: DiceTheme;
  onChange: (theme: DiceTheme) => void;
};

export function DiceThemeControls({
  disabled,
  theme,
  onChange,
}: DiceThemeControlsProps) {
  const selectedColor = colorForColorset(theme.colorset);

  return (
    <div className="dice-theme-controls">
      <div className="dice-field dice-theme-controls__color">
        <label htmlFor="dice-colorset">Color</label>
        <div className="dice-select-with-swatch">
          <span
            aria-hidden="true"
            className="dice-colorset-swatch"
            style={{ backgroundColor: selectedColor }}
          />
          <select
            disabled={disabled}
            id="dice-colorset"
            onChange={(event) =>
              onChange({
                ...theme,
                colorset: event.target.value as DiceTheme["colorset"],
              })
            }
            value={theme.colorset}
          >
            {DICE_COLORSETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="dice-field">
        <label htmlFor="dice-texture">Texture</label>
        <select
          disabled={disabled}
          id="dice-texture"
          onChange={(event) =>
            onChange({
              ...theme,
              texture: event.target.value as DiceTheme["texture"],
            })
          }
          value={theme.texture}
        >
          {DICE_TEXTURES.map((option) => (
            <option
              key={option.value || "colorset-default"}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dice-field">
        <label htmlFor="dice-material">Material</label>
        <select
          disabled={disabled}
          id="dice-material"
          onChange={(event) =>
            onChange({
              ...theme,
              material: event.target.value as DiceTheme["material"],
            })
          }
          value={theme.material}
        >
          {DICE_MATERIALS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dice-theme-controls__sound">
        <span className="dice-field__label">Sound</span>
        <button
          aria-label={theme.soundEnabled ? "Turn sound off" : "Turn sound on"}
          aria-pressed={theme.soundEnabled}
          className="dice-sound-toggle"
          disabled={disabled}
          onClick={() =>
            onChange({ ...theme, soundEnabled: !theme.soundEnabled })
          }
          type="button"
        >
          {theme.soundEnabled ? (
            <Volume2 aria-hidden="true" />
          ) : (
            <VolumeX aria-hidden="true" />
          )}
          <span>{theme.soundEnabled ? "On" : "Off"}</span>
        </button>
      </div>
      <p className="dice-theme-controls__hint">
        <Palette aria-hidden="true" /> Texture overrides a colorset texture for
        future rolls.
      </p>
    </div>
  );
}
