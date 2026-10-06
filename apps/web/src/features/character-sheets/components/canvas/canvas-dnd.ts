import {
  closestCenter,
  pointerWithin,
  type Active,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
  type Over,
} from "@dnd-kit/core";
import type {
  CharacterSheetDraftV2,
  DraftLayoutV1,
  DraftMutationV2,
  DraftStructuralReadModelV2,
} from "@repo/character-sheet-draft";

/**
 * Explicit drop-intent model for the sheet Canvas (14.9).
 *
 * Every droppable on the Canvas declares exactly one intent instead of
 * relying on pointer position over a generic container:
 * - `before` / `after`: insertion rails around a Field or Section sibling;
 * - `inside`: a Section body (or the Root workspace) as a container.
 *
 * Intent IDs are stable strings (`canvas:before:field:<key>`,
 * `canvas:after:section:<key>`, `canvas:inside:<key|null>`), so tests and
 * Playwright can address geometry without brittle DOM ancestry. The domain
 * (`place_node`) stays the only place that mutates structure; this module
 * only resolves and pre-validates intent.
 */

export type CanvasNodeKind = "field" | "section";

export type CanvasDropIntent =
  | { kind: "before"; targetKind: CanvasNodeKind; key: string }
  | { kind: "after"; targetKind: CanvasNodeKind; key: string }
  | { kind: "inside"; sectionKey: string | null };

export type CanvasDropResolution =
  | {
      ok: true;
      destination: Extract<
        DraftMutationV2,
        { op: "place_node" }
      >["destination"];
    }
  | { ok: false; reason: string };

const INTENT_PREFIX = "canvas";

export function dropIntentId(intent: CanvasDropIntent): string {
  if (intent.kind === "inside") {
    return `${INTENT_PREFIX}:inside:${intent.sectionKey ?? "root"}`;
  }
  return `${INTENT_PREFIX}:${intent.kind}:${intent.targetKind}:${intent.key}`;
}

/** Parses a droppable id back into intent. Returns null for foreign ids. */
export function parseDropIntentId(id: string): CanvasDropIntent | null {
  const parts = id.split(":");
  if (parts[0] !== INTENT_PREFIX) {
    return null;
  }
  if (parts[1] === "inside" && parts.length === 3) {
    const raw = parts[2];
    if (raw === undefined || raw === "") {
      return null;
    }
    return {
      kind: "inside",
      sectionKey: raw === "root" ? null : raw,
    };
  }
  if (
    (parts[1] === "before" || parts[1] === "after") &&
    parts.length === 4 &&
    (parts[2] === "field" || parts[2] === "section") &&
    parts[3] !== undefined &&
    parts[3] !== ""
  ) {
    return { kind: parts[1], targetKind: parts[2], key: parts[3] };
  }
  return null;
}

export interface DropValidityContext {
  readModel: DraftStructuralReadModelV2;
  layout: DraftLayoutV1;
  sourceKey: string;
  sourceKind: CanvasNodeKind;
}

/**
 * Resolves a drop intent to a `place_node` destination, pre-validating
 * obvious constraints client-side. The domain/store remains final authority;
 * this only drives drop-target styling, messaging, and which menu entries
 * are offered.
 *
 * Checked in order: unknown source/target, self target, descendant target,
 * destination geometry fit. Never clamps: an unfitting destination resolves
 * to `{ ok: false }` with a human-readable reason.
 */
export function resolveDropDestination(
  context: DropValidityContext,
  intent: CanvasDropIntent,
): CanvasDropResolution {
  const { readModel, sourceKey } = context;
  const source = readModel.nodeByKey.get(sourceKey);
  if (source === undefined) {
    return { ok: false, reason: `Unknown item "${sourceKey}".` };
  }

  if (intent.kind === "inside") {
    if (intent.sectionKey === null) {
      return resolveInside(context, null);
    }
    const target = readModel.nodeByKey.get(intent.sectionKey);
    if (target === undefined || target.kind !== "section") {
      return {
        ok: false,
        reason: `Unknown section "${intent.sectionKey}".`,
      };
    }
    if (intent.sectionKey === sourceKey) {
      return {
        ok: false,
        reason: `Cannot move "${sourceKey}" inside itself.`,
      };
    }
    if (isDescendantOf(readModel, intent.sectionKey, sourceKey)) {
      return {
        ok: false,
        reason: `Cannot move "${sourceKey}" inside "${intent.sectionKey}" because it is inside "${sourceKey}".`,
      };
    }
    return resolveInside(context, intent.sectionKey);
  }

  const target = readModel.nodeByKey.get(intent.key);
  if (target === undefined) {
    return { ok: false, reason: `Unknown target "${intent.key}".` };
  }
  if (intent.key === sourceKey) {
    return {
      ok: false,
      reason: `Cannot move "${sourceKey}" ${intent.kind} itself.`,
    };
  }
  return resolveSibling(context, intent, target.parentKey);
}

function resolveInside(
  context: DropValidityContext,
  sectionKey: string | null,
): CanvasDropResolution {
  const fit = checkGeometryFit(context, sectionKey);
  if (fit !== null) {
    return { ok: false, reason: fit };
  }
  return {
    ok: true,
    destination: { position: "inside", parentKey: sectionKey },
  };
}

function resolveSibling(
  context: DropValidityContext,
  intent: Extract<CanvasDropIntent, { kind: "before" | "after" }>,
  parentKey: string | null,
): CanvasDropResolution {
  const fit = checkGeometryFit(context, parentKey);
  if (fit !== null) {
    return { ok: false, reason: fit };
  }
  return {
    ok: true,
    destination:
      intent.kind === "before"
        ? { position: "before", targetKey: intent.key }
        : { position: "after", targetKey: intent.key },
  };
}

/**
 * Geometry pre-check mirroring the domain rule: preserved node geometry must
 * fit the destination container columns. Returns a human reason or null.
 */
function checkGeometryFit(
  context: DropValidityContext,
  destinationParentKey: string | null,
): string | null {
  const { layout, sourceKey } = context;
  const geometry = layout.nodes[sourceKey];
  if (geometry === undefined) {
    return null;
  }
  const columns =
    destinationParentKey === null
      ? layout.root.columns
      : (layout.sections[destinationParentKey]?.columns ?? null);
  if (columns === null) {
    return `Unknown destination section.`;
  }
  if (
    geometry.columnStart > columns ||
    geometry.columnStart + geometry.columnSpan - 1 > columns
  ) {
    const where = destinationParentKey === null ? "this sheet" : "this section";
    return `Doesn't fit ${where} (${columns} column${columns === 1 ? "" : "s"}). Resize it first.`;
  }
  return null;
}

function isDescendantOf(
  readModel: DraftStructuralReadModelV2,
  key: string,
  ancestorKey: string,
): boolean {
  let current = readModel.nodeByKey.get(key)?.parentKey ?? null;
  while (current !== null) {
    if (current === ancestorKey) {
      return true;
    }
    current = readModel.nodeByKey.get(current)?.parentKey ?? null;
  }
  return false;
}

export interface IntentLabels {
  sourceLabel: string;
  targetLabel: string;
  parentLabel: string;
}

/** Human-readable description of a hovered/committed intent. */
export function describeDropIntent(
  intent: CanvasDropIntent,
  labels: IntentLabels,
): string {
  if (intent.kind === "inside") {
    if (intent.sectionKey === null) {
      return `${labels.sourceLabel}, move to top level.`;
    }
    return `${labels.sourceLabel}, move inside ${labels.targetLabel}.`;
  }
  const where =
    labels.parentLabel === "" ? "at top level" : `in ${labels.parentLabel}`;
  return `${labels.sourceLabel}, insert ${intent.kind} ${labels.targetLabel} ${where}.`;
}

/**
 * Human-readable confirmation of a committed drop, computed synchronously
 * from the draft: "Agility moved to position 2 of 4 in Attributes."
 */
export function describeDropResult(
  draft: CharacterSheetDraftV2,
  readModel: DraftStructuralReadModelV2,
  sections: CharacterSheetDraftV2["sections"],
  sourceKey: string,
  sourceLabel: string,
  destination: Extract<DraftMutationV2, { op: "place_node" }>["destination"],
): string {
  const parentKey =
    destination.position === "inside"
      ? destination.parentKey
      : (readModel.nodeByKey.get(
          destination.position === "before" || destination.position === "after"
            ? destination.targetKey
            : "",
        )?.parentKey ?? null);
  const siblings = draft.structure.filter(
    (placement) =>
      (placement.parentKey ?? null) === parentKey &&
      placement.key !== sourceKey,
  );
  let index = siblings.length;
  if (destination.position !== "inside") {
    const targetIndex = siblings.findIndex(
      (placement) => placement.key === destination.targetKey,
    );
    if (targetIndex >= 0) {
      index = targetIndex + (destination.position === "after" ? 1 : 0);
    }
  }
  const total = siblings.length + 1;
  const where =
    parentKey === null
      ? "at top level"
      : `in ${sections.find((entry) => entry.key === parentKey)?.title ?? parentKey}`;
  return `${sourceLabel} moved to position ${index + 1} of ${total} ${where}.`;
}

export interface CanvasMoveTarget {
  id: string;
  label: string;
  destination: Extract<DraftMutationV2, { op: "place_node" }>["destination"];
}

/**
 * Every valid structural destination for a node, for keyboard move menus
 * and the inspector Move control: before/after each sibling, inside each
 * valid section, and top level. Invalid options are omitted, never offered
 * disabled-without-reason — the reason stays available through drop
 * feedback and announcements instead.
 */
export function validMoveTargets(
  readModel: DraftStructuralReadModelV2,
  layout: DraftLayoutV1,
  sections: CharacterSheetDraftV2["sections"],
  sourceKey: string,
  sourceKind: CanvasNodeKind,
  labelOf: (key: string) => string,
): CanvasMoveTarget[] {
  const context: DropValidityContext = {
    readModel,
    layout,
    sourceKey,
    sourceKind,
  };
  const targets: CanvasMoveTarget[] = [];
  const source = readModel.nodeByKey.get(sourceKey);
  if (source === undefined) {
    return targets;
  }

  const siblings = readModel.childrenByParent.get(source.parentKey) ?? [];
  for (const sibling of siblings) {
    if (sibling.key === sourceKey) {
      continue;
    }
    for (const kind of ["before", "after"] as const) {
      const intent: CanvasDropIntent = {
        kind,
        targetKind: sibling.kind,
        key: sibling.key,
      };
      const resolved = resolveDropDestination(context, intent);
      if (resolved.ok) {
        targets.push({
          id: dropIntentId(intent),
          label: `${kind === "before" ? "Before" : "After"} ${labelOf(sibling.key)}`,
          destination: resolved.destination,
        });
      }
    }
  }

  for (const section of sections) {
    if (section.key === sourceKey) {
      continue;
    }
    const intent: CanvasDropIntent = {
      kind: "inside",
      sectionKey: section.key,
    };
    const resolved = resolveDropDestination(context, intent);
    if (resolved.ok) {
      targets.push({
        id: dropIntentId(intent),
        label: `Inside ${labelOf(section.key)}`,
        destination: resolved.destination,
      });
    }
  }

  const rootIntent: CanvasDropIntent = { kind: "inside", sectionKey: null };
  const rootResolved = resolveDropDestination(context, rootIntent);
  if (rootResolved.ok && source.parentKey !== null) {
    targets.push({
      id: dropIntentId(rootIntent),
      label: "To top level",
      destination: rootResolved.destination,
    });
  }

  return targets;
}

/** Screen-reader instructions for sheet drag handles (dnd-kit v6 shape). */
export const canvasScreenReaderInstructions = {
  draggable:
    "To pick up a sheet item, focus its Move handle and press Space. Choose a destination from the move menu, press Enter to drop, or press Escape to cancel.",
};

/** Movement announcements with human-readable sheet labels. */
export function canvasAnnouncements(labelOf: (key: string) => string): {
  onDragStart(event: { active: Active }): string | undefined;
  onDragOver(event: { active: Active; over: Over | null }): string | undefined;
  onDragEnd(event: { active: Active; over: Over | null }): string | undefined;
  onDragCancel(): string | undefined;
} {
  return {
    onDragStart({ active }) {
      const data = active.data.current as
        { label?: unknown; kind?: unknown } | undefined;
      const label =
        typeof data?.label === "string" ? data.label : String(active.id);
      return `Picked up ${label}.`;
    },
    onDragOver({ active, over }) {
      if (over === null || over === undefined) {
        return undefined;
      }
      const intent = parseDropIntentId(String(over.id));
      if (intent === null) {
        return undefined;
      }
      const source = active.data.current as
        { key?: unknown; label?: unknown } | undefined;
      const sourceLabel =
        typeof source?.label === "string" ? source.label : String(active.id);
      const target = over.data.current as
        | {
            targetKey?: unknown;
            targetLabel?: unknown;
            parentLabel?: unknown;
            sectionKey?: unknown;
          }
        | undefined;
      const targetKey =
        typeof target?.targetKey === "string"
          ? target.targetKey
          : typeof target?.sectionKey === "string"
            ? target.sectionKey
            : null;
      return describeDropIntent(intent, {
        sourceLabel,
        targetLabel:
          typeof target?.targetLabel === "string"
            ? target.targetLabel
            : targetKey === null
              ? "top level"
              : labelOf(targetKey),
        parentLabel:
          typeof target?.parentLabel === "string" ? target.parentLabel : "",
      });
    },
    onDragEnd() {
      // Intentionally silent: the Canvas live region announces the committed
      // result with positional detail ("moved to position 2 of 4"), which a
      // generic drop message would only duplicate.
      return undefined;
    },
    onDragCancel() {
      return "Move cancelled.";
    },
  };
}

/**
 * Collision resolver prioritizing the most specific active intent over large
 * parent containers (fixes the nested-container problem where a Section body
 * would otherwise always win over a child insertion rail).
 *
 * With pointer coordinates: pointer-contained rails first, then
 * pointer-contained bodies smallest-area-first. Without pointer coordinates
 * (keyboard drags): closestCenter fallback.
 */
export const canvasCollisionDetection: CollisionDetection = (args) => {
  const { droppableContainers, pointerCoordinates } = args;
  if (pointerCoordinates === null) {
    return closestCenter(args);
  }
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length === 0) {
    return closestCenter(args);
  }
  const isRail = (container: DroppableContainer): boolean => {
    const id = String(container.id);
    return id.includes(":before:") || id.includes(":after:");
  };
  const isSectionBody = (container: DroppableContainer): boolean => {
    const id = String(container.id);
    return id.startsWith("canvas:inside:") && !id.endsWith(":root");
  };
  const isRootZone = (container: DroppableContainer): boolean => {
    const id = String(container.id);
    return id === "canvas:inside:root";
  };
  const byArea = (
    a: Collision,
    b: Collision,
    containers: DroppableContainer[],
  ): number => areaOf(containers, a) - areaOf(containers, b);
  const rails = pointerCollisions
    .filter((collision) =>
      droppableContainers.some(
        (container) => container.id === collision.id && isRail(container),
      ),
    )
    .sort((a, b) => byArea(a, b, droppableContainers));
  if (rails.length > 0) {
    return rails;
  }
  const sectionBodies = pointerCollisions
    .filter((collision) =>
      droppableContainers.some(
        (container) =>
          container.id === collision.id && isSectionBody(container),
      ),
    )
    .sort((a, b) => byArea(a, b, droppableContainers));
  if (sectionBodies.length > 0) {
    return sectionBodies;
  }
  const rootZones = pointerCollisions
    .filter((collision) =>
      droppableContainers.some(
        (container) => container.id === collision.id && isRootZone(container),
      ),
    )
    .sort((a, b) => byArea(a, b, droppableContainers));
  if (rootZones.length > 0) {
    return rootZones;
  }
  return pointerCollisions.sort((a, b) => byArea(a, b, droppableContainers));
};

function areaOf(
  containers: DroppableContainer[],
  collision: Collision,
): number {
  const container = containers.find((entry) => entry.id === collision.id);
  const rect = container?.rect.current;
  if (rect === undefined || rect === null) {
    return Number.POSITIVE_INFINITY;
  }
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return width * height;
}
