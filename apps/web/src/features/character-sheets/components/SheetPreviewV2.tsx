import type { ReactNode } from "react";
import type {
  CharacterSheetDraftV2,
  DraftReadNodeV2,
} from "@repo/character-sheet-draft";
import {
  gridContainerStyle,
  gridItemStyle,
  SpatialNodes,
  useSpatialSurface,
  type SpatialSurface,
} from "./canvas/spatial-surface";
import { previewValue } from "./field-value-preview";

interface SheetPreviewV2Props {
  draft: CharacterSheetDraftV2;
}

/**
 * Read-only V2 preview rendered through the shared spatial surface:
 * hierarchy from the canonical structural read model, geometry from the
 * effective layout resolver. No projection gate: a draft richer than the flat
 * technical spec still previews.
 *
 * This is NOT the Phase 14.9 Canvas: no drag handles, no resize handles, no
 * insertion system.
 */
export function SheetPreviewV2({ draft }: SheetPreviewV2Props) {
  const surface = useSpatialSurface(draft);

  if (surface === null) {
    return (
      <div className="character-workshop__panel">
        <div className="character-workshop__panel-title">Preview</div>
        <div className="character-workshop__preview-value character-workshop__preview-value--empty">
          Preview unavailable for this draft.
        </div>
      </div>
    );
  }

  return (
    <div className="character-workshop__sheet" aria-label="Sheet preview">
      <div className="character-workshop__sheet-header">
        <h2 className="character-workshop__sheet-title">
          {draft.characterName ?? "Untitled draft"}
        </h2>
      </div>
      <div
        className="character-workshop__sheet-body"
        style={gridContainerStyle(surface.layout.root.columns)}
      >
        <SpatialNodes
          surface={surface}
          nodes={surface.readModel.roots}
          renderSection={(node, children) => (
            <PreviewSection surface={surface} node={node}>
              {children}
            </PreviewSection>
          )}
          renderField={(node) => (
            <PreviewField draft={draft} surface={surface} node={node} />
          )}
        />
      </div>
    </div>
  );
}

function PreviewSection({
  surface,
  node,
  children,
}: {
  surface: SpatialSurface;
  node: Extract<DraftReadNodeV2, { kind: "section" }>;
  children: ReactNode;
}) {
  const geometry = surface.layout.nodes[node.key];
  const container = surface.layout.sections[node.key];
  if (geometry === undefined || container === undefined) {
    return null;
  }
  return (
    <section
      className="character-workshop__preview-section"
      data-depth={node.depth}
      aria-labelledby={`preview-section-${node.key}`}
      style={gridItemStyle(geometry)}
    >
      <h3
        id={`preview-section-${node.key}`}
        className="character-workshop__preview-section-title"
      >
        {node.section.title}
      </h3>
      <div
        className="character-workshop__preview-section-fields"
        style={gridContainerStyle(container.columns)}
      >
        {children}
      </div>
    </section>
  );
}

function PreviewField({
  draft,
  surface,
  node,
}: {
  draft: CharacterSheetDraftV2;
  surface: SpatialSurface;
  node: Extract<DraftReadNodeV2, { kind: "field" }>;
}) {
  const geometry = surface.layout.nodes[node.key];
  if (geometry === undefined) {
    return null;
  }
  const rendered = previewValue(node.field, draft.values[node.key] ?? null);
  return (
    <div
      className="character-workshop__preview-field"
      style={gridItemStyle(geometry)}
    >
      <span className="character-workshop__preview-label">
        {node.field.label}
      </span>
      <span
        className={
          rendered === ""
            ? "character-workshop__preview-value character-workshop__preview-value--empty"
            : "character-workshop__preview-value"
        }
      >
        {rendered === "" ? "—" : rendered}
      </span>
    </div>
  );
}
