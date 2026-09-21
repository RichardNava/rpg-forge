import { useEffect, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  CharacterSheetDraft,
  DraftMutation,
  DraftSection,
  DraftValue,
} from "@repo/character-sheet-draft";
import { FieldEditor } from "./FieldEditor";

export interface WorkshopSidebarCallbacks {
  onSetValue(key: string, value: DraftValue): void;
  onClearValue(key: string): void;
  onRemoveField(key: string): void;
  onSetFieldLabel(key: string, label: string): void;
  onSetFieldType(
    field: Extract<DraftMutation, { op: "set_field_type" }>["field"],
  ): void;
  onAddSection(
    section: Extract<DraftMutation, { op: "add_section" }>["section"],
  ): void;
  onRenameSection(key: string, title: string): void;
  onMoveField(key: string, sectionKey: string | null): void;
  onReparentSection(key: string, parentKey: string | null): void;
  onAddField(): void;
  onOpenAddSection?(): void;
}

interface WorkshopSidebarProps {
  draft: CharacterSheetDraft;
  callbacks: WorkshopSidebarCallbacks;
  disabled: boolean;
}

export function applyWorkshopDrop(
  source: { kind: "field" | "section"; key: string },
  target: { kind: "section"; key: string | null } | undefined,
  callbacks: Pick<
    WorkshopSidebarCallbacks,
    "onMoveField" | "onReparentSection"
  >,
): void {
  if (target === undefined) return;
  if (source.kind === "field") {
    callbacks.onMoveField(source.key, target.key);
  } else if (source.key !== target.key) {
    callbacks.onReparentSection(source.key, target.key);
  }
}

/** The workshop's full-width editor. Assignment stays available by select, not drag-only controls. */
export function WorkshopSidebar({
  draft,
  callbacks,
  disabled,
}: WorkshopSidebarProps) {
  return (
    <section
      className="character-workshop__panel character-workshop__editor"
      aria-label={`Fields (${draft.fields.length})`}
    >
      <header className="character-workshop__editor-header">
        <div>
          <h2 className="character-workshop__panel-title">Sheet fields</h2>
          <p>{draft.fields.length} of 192 fields</p>
        </div>
        {!disabled && callbacks.onOpenAddSection !== undefined && (
          <div className="character-workshop__editor-actions">
            <button
              type="button"
              className="character-workshop__btn character-workshop__btn--secondary"
              onClick={callbacks.onOpenAddSection}
            >
              Add section
            </button>
          </div>
        )}
      </header>
      <div className="character-workshop__field-list">
        <GroupedFields
          draft={draft}
          callbacks={callbacks}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

function GroupedFields({ draft, callbacks, disabled }: WorkshopSidebarProps) {
  const sections = draft.sections ?? [];
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const assigned = new Set(sections.flatMap((section) => section.fieldKeys));
  function handleDragEnd(event: DragEndEvent) {
    const source = event.active.data.current;
    const target = event.over?.data.current;
    setActiveLabel(null);
    if (
      (source?.kind === "field" || source?.kind === "section") &&
      typeof source.key === "string" &&
      target?.kind === "section" &&
      (typeof target.key === "string" || target.key === null)
    ) {
      applyWorkshopDrop(
        { kind: source.kind, key: source.key },
        { kind: "section", key: target.key },
        callbacks,
      );
    }
  }
  const content =
    sections.length === 0 ? (
      <FieldCards
        draft={draft}
        fieldKeys={draft.fields.map((field) => field.key)}
        callbacks={callbacks}
        disabled={disabled}
      />
    ) : (
      <>
        {sections
          .filter((section) => section.parentKey === undefined)
          .map((section) => (
            <SectionEditor
              key={section.key}
              section={section}
              sections={sections}
              draft={draft}
              callbacks={callbacks}
              disabled={disabled}
              depth={0}
            />
          ))}
        {draft.fields.some((field) => !assigned.has(field.key)) && (
          <section className="character-workshop__field-group">
            <h3 className="character-workshop__field-group-title">
              Other fields
            </h3>
            <FieldCards
              draft={draft}
              fieldKeys={draft.fields
                .filter((field) => !assigned.has(field.key))
                .map((field) => field.key)}
              callbacks={callbacks}
              disabled={disabled}
            />
          </section>
        )}
      </>
    );
  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragStart={(event) =>
        setActiveLabel(String(event.active.data.current?.label ?? "item"))
      }
      onDragCancel={() => setActiveLabel(null)}
      onDragEnd={handleDragEnd}
    >
      {content}
      <DropZone
        id="unassigned"
        label="Unassigned fields"
        data={{ kind: "section", key: null }}
      />
      <DropZone
        id="top-level"
        label="Top-level sections"
        data={{ kind: "section", key: null }}
      />
      <DragOverlay>
        {activeLabel === null ? null : (
          <span className="character-workshop__drag-overlay">
            Moving {activeLabel}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SectionEditor({
  section,
  sections,
  draft,
  callbacks,
  disabled,
  depth,
}: {
  section: DraftSection;
  sections: DraftSection[];
  draft: CharacterSheetDraft;
  callbacks: WorkshopSidebarCallbacks;
  disabled: boolean;
  depth: number;
}) {
  const [title, setTitle] = useState(section.title);
  const descendants = descendantKeys(section.key, sections);
  useEffect(() => setTitle(section.title), [section.title]);
  const draggable = useDraggable({
    id: `section:${section.key}`,
    disabled,
    data: { kind: "section", key: section.key, label: section.title },
  });
  const droppable = useDroppable({
    id: `section-target:${section.key}`,
    data: { kind: "section", key: section.key },
  });
  function commitTitle() {
    const next = title.trim();
    if (next === "") setTitle(section.title);
    else if (next !== section.title)
      callbacks.onRenameSection(section.key, next);
  }
  return (
    <section
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      className="character-workshop__field-group"
      data-depth={depth}
      aria-labelledby={`section-${section.key}`}
    >
      <div className="character-workshop__section-heading">
        <h3
          id={`section-${section.key}`}
          className="character-workshop__field-group-title"
        >
          {section.title}
        </h3>
        {!disabled && (
          <button
            type="button"
            className="character-workshop__drag-handle"
            ref={draggable.setActivatorNodeRef}
            {...draggable.listeners}
            {...draggable.attributes}
          >
            Move section
          </button>
        )}
        {!disabled && (
          <details className="character-workshop__section-settings">
            <summary>
              Section settings
              <span className="character-workshop__sr-only">
                {" "}
                for {section.title}
              </span>
            </summary>
            <div>
              <label className="character-workshop__form-field">
                <span>Section title</span>
                <input
                  aria-label={`Title for ${section.title}`}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="character-workshop__form-field">
                <span>Parent section</span>
                <select
                  aria-label={`Parent section for ${section.title}`}
                  value={section.parentKey ?? ""}
                  onChange={(event) =>
                    callbacks.onReparentSection(
                      section.key,
                      event.currentTarget.value || null,
                    )
                  }
                >
                  <option value="">Top level</option>
                  {sections
                    .filter(
                      (candidate) =>
                        candidate.key !== section.key &&
                        !descendants.has(candidate.key),
                    )
                    .map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </details>
        )}
      </div>
      <FieldCards
        draft={draft}
        fieldKeys={section.fieldKeys}
        callbacks={callbacks}
        disabled={disabled}
      />
      {sections
        .filter((child) => child.parentKey === section.key)
        .map((child) => (
          <SectionEditor
            key={child.key}
            section={child}
            sections={sections}
            draft={draft}
            callbacks={callbacks}
            disabled={disabled}
            depth={depth + 1}
          />
        ))}
    </section>
  );
}

function FieldCards({
  draft,
  fieldKeys,
  callbacks,
  disabled,
}: {
  draft: CharacterSheetDraft;
  fieldKeys: string[];
  callbacks: WorkshopSidebarCallbacks;
  disabled: boolean;
}) {
  return (
    <div className="character-workshop__field-grid">
      {fieldKeys.flatMap((key) => {
        const field = draft.fields.find((entry) => entry.key === key);
        return field === undefined ? (
          []
        ) : (
          <DraggableField
            key={field.key}
            field={field}
            draft={draft}
            callbacks={callbacks}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}

function DraggableField({
  field,
  draft,
  callbacks,
  disabled,
}: {
  field: CharacterSheetDraft["fields"][number];
  draft: CharacterSheetDraft;
  callbacks: WorkshopSidebarCallbacks;
  disabled: boolean;
}) {
  const draggable = useDraggable({
    id: `field:${field.key}`,
    disabled,
    data: { kind: "field", key: field.key, label: field.label },
  });
  return (
    <div
      ref={draggable.setNodeRef}
      className="character-workshop__draggable-field"
    >
      <button
        type="button"
        className="character-workshop__drag-handle"
        aria-label={`Move ${field.label}`}
        ref={draggable.setActivatorNodeRef}
        {...draggable.listeners}
        {...draggable.attributes}
      >
        Move
      </button>
      <FieldEditor
        field={field}
        draft={draft}
        callbacks={callbacks}
        disabled={disabled}
      />
    </div>
  );
}

function DropZone({
  id,
  label,
  data,
}: {
  id: string;
  label: string;
  data: { kind: "section"; key: string | null };
}) {
  const droppable = useDroppable({ id, data });
  return (
    <div
      ref={droppable.setNodeRef}
      className={
        droppable.isOver
          ? "character-workshop__drop-zone character-workshop__drop-zone--active"
          : "character-workshop__drop-zone"
      }
    >
      {label}
    </div>
  );
}

function descendantKeys(
  sectionKey: string,
  sections: DraftSection[],
): Set<string> {
  const descendants = new Set<string>();
  const pending = [sectionKey];
  while (pending.length > 0) {
    const parentKey = pending.pop();
    for (const section of sections)
      if (section.parentKey === parentKey && !descendants.has(section.key)) {
        descendants.add(section.key);
        pending.push(section.key);
      }
  }
  return descendants;
}
