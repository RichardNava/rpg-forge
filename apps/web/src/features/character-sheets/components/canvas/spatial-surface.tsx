import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  buildDraftStructuralReadModelV2,
  DEFAULT_DRAFT_NODE_LAYOUT_V1,
  resolveEffectiveDraftLayoutV1,
  type CharacterSheetDraftV2,
  type DraftLayoutNodeV1,
  type DraftLayoutV1,
  type DraftReadNodeV2,
  type DraftStructuralReadModelV2,
} from "@repo/character-sheet-draft";

/**
 * Shared spatial rendering layer for the sheet surface (14.9).
 *
 * Both the read-only Preview and the editable Canvas render from this
 * single layer:
 * - hierarchy and canonical order from the canonical structural read model;
 * - geometry from the effective layout resolver (explicit layout, or
 *   deterministic defaults for layoutless history);
 * - the same nested CSS Grid semantics (containers + item geometry +
 *   break-before breakers).
 *
 * There is no copied traversal, no second tree, and no layout inference:
 * node chrome (preview spans vs canvas cards/handles/rails) is injected
 * through render callbacks, while traversal, grids, and geometry stay here.
 */

export interface SpatialSurface {
  readModel: DraftStructuralReadModelV2;
  layout: DraftLayoutV1;
}

/** Resolves hierarchy + geometry for a draft, or null when invalid. */
export function useSpatialSurface(
  draft: CharacterSheetDraftV2,
): SpatialSurface | null {
  return useMemo(() => {
    try {
      return {
        readModel: buildDraftStructuralReadModelV2(draft),
        layout: resolveEffectiveDraftLayoutV1(draft),
      };
    } catch {
      return null;
    }
  }, [draft]);
}

export function gridContainerStyle(columns: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };
}

export function gridItemStyle(geometry: DraftLayoutNodeV1): CSSProperties {
  return {
    gridColumn: `${geometry.columnStart} / span ${geometry.columnSpan}`,
    gridRow: `span ${geometry.rowSpan}`,
  };
}

/** Full-row breaker forcing subsequent auto-flow onto a fresh row. */
export function SpatialBreaker() {
  return <div aria-hidden="true" style={{ gridColumn: "1 / -1" }} />;
}

export interface SpatialTreeProps {
  surface: SpatialSurface;
  nodes: readonly DraftReadNodeV2[];
  renderSection(
    node: Extract<DraftReadNodeV2, { kind: "section" }>,
    children: ReactNode,
  ): ReactNode;
  renderField(node: Extract<DraftReadNodeV2, { kind: "field" }>): ReactNode;
}

/** Single canonical traversal shared by Preview and Canvas. */
export function SpatialNodes({
  surface,
  nodes,
  renderSection,
  renderField,
}: SpatialTreeProps) {
  return (
    <>
      {nodes.map((node) => (
        <Fragment key={node.key}>
          {node.kind === "section" ? (
            <>
              {geometryOf(surface, node.key).breakBefore && <SpatialBreaker />}
              {renderSection(
                node,
                <SpatialNodes
                  surface={surface}
                  nodes={surface.readModel.childrenByParent.get(node.key) ?? []}
                  renderSection={renderSection}
                  renderField={renderField}
                />,
              )}
            </>
          ) : (
            <>
              {geometryOf(surface, node.key).breakBefore && <SpatialBreaker />}
              {renderField(node)}
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

function geometryOf(surface: SpatialSurface, key: string): DraftLayoutNodeV1 {
  // Unreachable for a resolved surface (effective layout is complete), kept
  // so a missing entry renders instead of crashing.
  return surface.layout.nodes[key] ?? { ...DEFAULT_DRAFT_NODE_LAYOUT_V1 };
}
