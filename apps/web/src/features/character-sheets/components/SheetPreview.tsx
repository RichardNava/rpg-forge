import { useMemo } from "react";
import {
  projectDraftToSpec,
  type CharacterSheetDraft,
} from "@repo/character-sheet-draft";
import { previewValue } from "./FieldEditor";

interface SheetPreviewProps {
  draft: CharacterSheetDraft;
}

/**
 * Live read-only preview of the editable draft. The draft is validated through
 * the genuine `projectDraftToSpec` projection so the preview only renders when
 * an export would also succeed; field rendering then reads from the draft
 * surface, which is exactly the single-flow projection an export produces.
 */
export function SheetPreview({ draft }: SheetPreviewProps) {
  const spec = useMemo(() => {
    try {
      return projectDraftToSpec(draft);
    } catch {
      return null;
    }
  }, [draft]);

  if (spec === null) {
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
        <PreviewGroups draft={draft} />
      </div>
    </div>
  );
}

function PreviewGroups({ draft }: { draft: CharacterSheetDraft }) {
  const sections = draft.sections ?? [];
  if (sections.length === 0)
    return draft.fields.map((field) => (
      <PreviewField key={field.key} draft={draft} fieldKey={field.key} />
    ));
  const assigned = new Set(sections.flatMap((section) => section.fieldKeys));
  return (
    <>
      {sections
        .filter((section) => section.parentKey === undefined)
        .map((section) => (
          <PreviewSection
            key={section.key}
            sectionKey={section.key}
            draft={draft}
            depth={0}
          />
        ))}
      {draft.fields
        .filter((field) => !assigned.has(field.key))
        .map((field) => (
          <PreviewField key={field.key} draft={draft} fieldKey={field.key} />
        ))}
    </>
  );
}

function PreviewSection({
  sectionKey,
  draft,
  depth,
}: {
  sectionKey: string;
  draft: CharacterSheetDraft;
  depth: number;
}) {
  const sections = draft.sections ?? [];
  const section = sections.find((entry) => entry.key === sectionKey);
  if (section === undefined) return null;
  return (
    <section
      className="character-workshop__preview-section"
      data-depth={depth}
      aria-labelledby={`preview-section-${section.key}`}
    >
      <h3
        id={`preview-section-${section.key}`}
        className="character-workshop__preview-section-title"
      >
        {section.title}
      </h3>
      <div className="character-workshop__preview-section-fields">
        {section.fieldKeys.map((key) => (
          <PreviewField key={key} draft={draft} fieldKey={key} />
        ))}
      </div>
      {sections
        .filter((child) => child.parentKey === section.key)
        .map((child) => (
          <PreviewSection
            key={child.key}
            sectionKey={child.key}
            draft={draft}
            depth={depth + 1}
          />
        ))}
    </section>
  );
}

function PreviewField({
  draft,
  fieldKey,
}: {
  draft: CharacterSheetDraft;
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
