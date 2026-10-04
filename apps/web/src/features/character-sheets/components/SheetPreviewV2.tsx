import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  buildDraftStructuralReadModelV2,
  resolveEffectiveDraftLayoutV1,
  type CharacterSheetDraftV2,
  type DraftLayoutNodeV1,
  type DraftLayoutV1,
  type DraftReadNodeV2,
} from "@repo/character-sheet-draft";
import { previewValue } from "./field-value-preview";

interface SheetPreviewV2Props {
  draft: CharacterSheetDraftV2;
}

function gridContainerStyle(columns: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  };
}

function gridItemStyle(geometry: DraftLayoutNodeV1): CSSProperties {
  return {
    gridColumn: `${geometry.columnStart} / span ${geometry.columnSpan}`,
    gridRow: `span ${geometry.rowSpan}`,
  };
}

/**
 * Read-only V2 preview rendered directly from the Draft spatial contract.
 *
 * Authority split, exactly as in the domain:
 * - hierarchy and canonical order come ONLY from the canonical structural
 *   read model (`buildDraftStructuralReadModelV2`);
 * - geometry comes ONLY from the effective layout resolver
 *   (`resolveEffectiveDraftLayoutV1`), so layoutless history previews with
 *   the same deterministic defaults the domain uses.
 *
 * Each container (Root, every Section) is a CSS grid; every node (Field or
 * Section) is a grid item carrying its own geometry, and every Section is
 * additionally a grid container for its children. A `breakBefore` node is
 * preceded by a full-row breaker so subsequent auto-flow starts on a fresh
 * row. No absolute positioning, no independent preview tree, no projection
 * gate: a draft richer than the flat technical spec still previews.
 *
 * This is NOT the Phase 14.9 Canvas: no drag handles, no resize handles, no
 * insertion system.
 */
export function SheetPreviewV2({ draft }: SheetPreviewV2Props) {
  const prepared = useMemo(() => {
    try {
      return {
        readModel: buildDraftStructuralReadModelV2(draft),
        layout: resolveEffectiveDraftLayoutV1(draft),
      };
    } catch {
      return null;
    }
  }, [draft]);

  if (prepared === null) {
    return (
      <div className="character-workshop__panel">
        <div className="character-workshop__panel-title">Preview</div>
        <div className="character-workshop__preview-value character-workshop__preview-value--empty">
          Preview unavailable for this draft.
        </div>
      </div>
    );
  }

  const { readModel, layout } = prepared;

  return (
    <div className="character-workshop__sheet" aria-label="Sheet preview">
      <div className="character-workshop__sheet-header">
        <h2 className="character-workshop__sheet-title">
          {draft.characterName ?? "Untitled draft"}
        </h2>
      </div>
      <div
        className="character-workshop__sheet-body"
        style={gridContainerStyle(layout.root.columns)}
      >
        <PreviewNodes
          fields={draft.fields}
          values={draft.values}
          layout={layout}
          nodes={readModel.roots}
          childrenByParent={readModel.childrenByParent}
        />
      </div>
    </div>
  );
}

function PreviewNodes({
  fields,
  values,
  layout,
  nodes,
  childrenByParent,
}: {
  fields: CharacterSheetDraftV2["fields"];
  values: CharacterSheetDraftV2["values"];
  layout: DraftLayoutV1;
  nodes: readonly DraftReadNodeV2[];
  childrenByParent: ReadonlyMap<string | null, readonly DraftReadNodeV2[]>;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "section" ? (
          <PreviewSection
            key={node.key}
            layout={layout}
            nodeKey={node.key}
            title={node.section.title}
            depth={node.depth}
          >
            <PreviewNodes
              fields={fields}
              values={values}
              layout={layout}
              nodes={childrenByParent.get(node.key) ?? []}
              childrenByParent={childrenByParent}
            />
          </PreviewSection>
        ) : (
          <PreviewField
            key={node.key}
            fields={fields}
            values={values}
            layout={layout}
            fieldKey={node.key}
          />
        ),
      )}
    </>
  );
}

function PreviewSection({
  layout,
  nodeKey,
  title,
  depth,
  children,
}: {
  layout: DraftLayoutV1;
  nodeKey: string;
  title: string;
  depth: number;
  children: ReactNode;
}) {
  const geometry = layout.nodes[nodeKey];
  const container = layout.sections[nodeKey];
  if (geometry === undefined || container === undefined) {
    return null;
  }
  return (
    <>
      {geometry.breakBefore && (
        <div aria-hidden="true" style={{ gridColumn: "1 / -1" }} />
      )}
      <section
        className="character-workshop__preview-section"
        data-depth={depth}
        aria-labelledby={`preview-section-${nodeKey}`}
        style={gridItemStyle(geometry)}
      >
        <h3
          id={`preview-section-${nodeKey}`}
          className="character-workshop__preview-section-title"
        >
          {title}
        </h3>
        <div
          className="character-workshop__preview-section-fields"
          style={gridContainerStyle(container.columns)}
        >
          {children}
        </div>
      </section>
    </>
  );
}

function PreviewField({
  fields,
  values,
  layout,
  fieldKey,
}: {
  fields: CharacterSheetDraftV2["fields"];
  values: CharacterSheetDraftV2["values"];
  layout: DraftLayoutV1;
  fieldKey: string;
}) {
  const field = fields.find((entry) => entry.key === fieldKey);
  const geometry = layout.nodes[fieldKey];
  if (field === undefined || geometry === undefined) {
    return null;
  }
  const rendered = previewValue(field, values[fieldKey] ?? null);
  return (
    <>
      {geometry.breakBefore && (
        <div aria-hidden="true" style={{ gridColumn: "1 / -1" }} />
      )}
      <div
        className="character-workshop__preview-field"
        style={gridItemStyle(geometry)}
      >
        <span className="character-workshop__preview-label">{field.label}</span>
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
    </>
  );
}
