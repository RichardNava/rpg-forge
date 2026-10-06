import { useMemo, useState } from "react";
import type {
  CharacterSheetDraftV2,
  DraftMutationV2,
} from "@repo/character-sheet-draft";
import { validMoveTargets, type CanvasNodeKind } from "./canvas-dnd";
import type { SpatialSurface } from "./spatial-surface";

/**
 * Keyboard move menu: the non-pointer structural move flow (14.9).
 *
 * Space/Enter on a drag handle opens this menu instead of starting a
 * pointer drag. Every option is a pre-validated destination (before/after a
 * sibling, inside a section, top level), so keyboard users reach exactly the
 * same outcomes as pointer drags. Enter commits, Escape cancels and restores
 * focus to the originating handle.
 */
export function KeyboardMoveMenu({
  draft,
  surface,
  entry,
  labelOf,
  onCommit,
  onCancel,
}: {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  entry: { kind: CanvasNodeKind; key: string; label: string };
  labelOf: (key: string) => string;
  onCommit(
    destination: Extract<DraftMutationV2, { op: "place_node" }>["destination"],
  ): void;
  onCancel(): void;
}) {
  const targets = useMemo(
    () =>
      validMoveTargets(
        surface.readModel,
        surface.layout,
        draft.sections,
        entry.key,
        entry.kind,
        labelOf,
      ),
    [surface, draft.sections, entry.key, entry.kind, labelOf],
  );
  const [choice, setChoice] = useState(targets[0]?.id ?? "");

  return (
    <div
      role="dialog"
      aria-label={`Move ${entry.label}`}
      className="canvas-move-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="canvas-move-menu__title">Move {entry.label} to…</p>
      {targets.length === 0 ? (
        <p className="canvas-move-menu__empty">
          No valid destinations right now.
        </p>
      ) : (
        <label className="character-workshop__form-field">
          <span>Destination</span>
          <select
            autoFocus
            aria-label={`Destination for ${entry.label}`}
            value={choice}
            onChange={(event) => setChoice(event.currentTarget.value)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="character-workshop__controls">
        <button
          type="button"
          className="character-workshop__btn character-workshop__btn--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="character-workshop__btn"
          disabled={targets.length === 0}
          onClick={() => {
            const target = targets.find((entry) => entry.id === choice);
            if (target !== undefined) {
              onCommit(target.destination);
            }
          }}
        >
          Move here
        </button>
      </div>
    </div>
  );
}
