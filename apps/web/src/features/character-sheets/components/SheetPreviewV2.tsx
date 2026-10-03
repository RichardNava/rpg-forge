import { useMemo } from "react";
import {
  buildDraftStructuralReadModelV2,
  projectDraftV2ToSpec,
  type CharacterSheetDraftV2,
  type DraftReadNodeV2,
} from "@repo/character-sheet-draft";
import { previewValue } from "./field-value-preview";

interface SheetPreviewV2Props {
  draft: CharacterSheetDraftV2;
}

/**
 * Parallel V2 read-only preview. The draft is validated through the genuine
 * `projectDraftV2ToSpec` projection so the preview only renders when an export
 * would also succeed; hierarchy then derives exclusively from
 * `buildDraftStructuralReadModelV2`, preserving canonical mixed Field/Section
 * sibling order with no registry-order fallback and no "Other fields" bucket.
 */
export function SheetPreviewV2({ draft }: SheetPreviewV2Props) {
  const spec = useMemo(() => {
    try {
      return projectDraftV2ToSpec(draft);
    } catch {
      return null;
    }
  }, [draft]);

  const readModel = useMemo(() => {
    try {
      return buildDraftStructuralReadModelV2(draft);
    } catch {
      return null;
    }
  }, [draft]);

  if (spec === null || readModel === null) {
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
          {spec.metadata.title}
        </h2>
      </div>
      <div className="character-workshop__sheet-body">
        <PreviewNodes
          draft={draft}
          nodes={readModel.roots}
          childrenByParent={readModel.childrenByParent}
        />
      </div>
    </div>
  );
}

function PreviewNodes({
  draft,
  nodes,
  childrenByParent,
}: {
  draft: CharacterSheetDraftV2;
  nodes: readonly DraftReadNodeV2[];
  childrenByParent: ReadonlyMap<string | null, readonly DraftReadNodeV2[]>;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "section" ? (
          <section
            key={node.key}
            className="character-workshop__preview-section"
            data-depth={node.depth}
            aria-labelledby={`preview-section-${node.key}`}
          >
            <h3
              id={`preview-section-${node.key}`}
              className="character-workshop__preview-section-title"
            >
              {node.section.title}
            </h3>
            <PreviewNodes
              draft={draft}
              nodes={childrenByParent.get(node.key) ?? []}
              childrenByParent={childrenByParent}
            />
          </section>
        ) : (
          <PreviewField key={node.key} draft={draft} fieldKey={node.key} />
        ),
      )}
    </>
  );
}

function PreviewField({
  draft,
  fieldKey,
}: {
  draft: CharacterSheetDraftV2;
  fieldKey: string;
}) {
  const field = draft.fields.find((entry) => entry.key === fieldKey);
  if (field === undefined) {
    return null;
  }
  const rendered = previewValue(field, draft.values[fieldKey] ?? null);
  return (
    <div className="character-workshop__preview-field">
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
  );
}
