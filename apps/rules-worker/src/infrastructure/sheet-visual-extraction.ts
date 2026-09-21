import { z } from "zod";
import {
  ExtractedCharacterStructureSchema,
  ExtractedControlSchema,
  MAX_EXTRACTED_CHARACTER_NODES,
  type ExtractedCharacterNode,
  type ExtractedCharacterStructure,
} from "../features/character-sheets/extraction/extracted-character-structure.js";

export interface SheetVisualExtractionPort {
  extract(input: {
    pages: readonly Blob[];
  }): Promise<ExtractedCharacterStructure>;
}

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

const ProviderNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string().trim().min(1).max(128),
    parentId: z.string().trim().min(1).max(128).nullable(),
    kind: z.literal("section"),
    label: z.string().trim().min(1).max(256),
  }),
  z.strictObject({
    id: z.string().trim().min(1).max(128),
    parentId: z.string().trim().min(1).max(128).nullable(),
    kind: z.literal("field"),
    label: z.string().trim().min(1).max(256),
    control: ExtractedControlSchema,
    value: z
      .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
      .optional(),
  }),
]);
type ProviderNode = z.infer<typeof ProviderNodeSchema>;

const MAX_EXTRACTION_DURATION_MS = 120_000;

const PROVIDER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodes"],
  properties: {
    nodes: {
      type: "array",
      maxItems: MAX_EXTRACTED_CHARACTER_NODES,
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
} as const;

/**
 * Observes a document's visible controls. It deliberately has no knowledge of
 * RPG Forge draft keys, section ids, editor state, or game-system rules.
 */
export function createCloudflareSheetVisualExtraction(
  ai: AiBinding,
  model: string,
  options: { debugRawResponse?: boolean } = {},
): SheetVisualExtractionPort {
  return {
    async extract({ pages }) {
      const structures: ExtractedCharacterNode[] = [];
      let retriesAttempted = 0;
      let retriesRecovered = 0;

      const deadline = Date.now() + MAX_EXTRACTION_DURATION_MS;
      for (const [pageIndex, page] of pages.entries()) {
        const image = await dataUri(page);
        let observation: { nodes: ProviderNode[] };
        let repaired = false;
        try {
          observation = await observePage(
            ai,
            model,
            image,
            options,
            false,
            deadline,
          );
        } catch (error) {
          retriesAttempted += 1;
          observation = await observePage(
            ai,
            model,
            image,
            options,
            true,
            deadline,
          );
          repaired = true;
          retriesRecovered += 1;
          console.info("character-sheet visual extraction recovered", {
            pageIndex,
            reason: observationFailureStage(error),
          });
        }
        if (!repaired && !hasSection(observation.nodes)) {
          retriesAttempted += 1;
          const repair = await observePage(
            ai,
            model,
            image,
            options,
            true,
            deadline,
          );
          observation = mergeObservationFields(observation, repair);
          retriesRecovered += 1;
        }
        try {
          structures.push(...rebuildTree(observation.nodes));
        } catch {
          throw new ObservationError("tree_integrity");
        }
      }

      const structure = ExtractedCharacterStructureSchema.parse({
        schemaVersion: "1",
        document: { pageCount: pages.length },
        nodes: structures,
      });
      console.info("character-sheet visual extraction", {
        pageCount: pages.length,
        observedNodeCount: countNodes(structure.nodes),
        observedSectionCount: countSections(structure.nodes),
        observedFieldCount: countFields(structure.nodes),
        maxDepth: maxDepth(structure.nodes),
        retriesAttempted,
        retriesRecovered,
      });
      return structure;
    },
  };
}

async function observePage(
  ai: AiBinding,
  model: string,
  image: string,
  options: { debugRawResponse?: boolean } = {},
  repair = false,
  deadline = Date.now() + MAX_EXTRACTION_DURATION_MS,
): Promise<{ nodes: ProviderNode[] }> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new ObservationError("timeout");
  const result = await runWithBudget(
    ai.run(model, {
      messages: [
        {
          role: "system",
          content:
            "Describe the visual structure of this character sheet. Return observed sections, subsections, and controls only. Do not invent rules, labels, fields, or groups. Return JSON only: exactly one object with a nodes array. Each node has kind section or field and label. Section nodes use children for nested sections and fields. Do not return id or parentId. Field nodes may include control.kind; use text when uncertain.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: repair
                ? "Return only one JSON object with a nodes array. Use section and field nodes with label and children. Do not return id or parentId. Use text when the visible control type is uncertain."
                : "Observe every visible section and editable control.",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: PROVIDER_RESPONSE_SCHEMA,
      },
    }),
    remainingMs,
  );
  const response =
    typeof result === "object" && result !== null
      ? (result as { response?: unknown }).response
      : null;
  if (options.debugRawResponse) {
    // Local-only opt-in diagnostic. Never enable this for remote environments.
    console.info("[character-sheet] raw vision response", response);
  }
  if (response === null || response === undefined) {
    throw new ObservationError("response_type");
  }
  let payload: unknown = response;
  try {
    if (typeof response === "string") payload = parseJsonObject(response);
  } catch {
    throw new ObservationError("json_parse");
  }
  const nodes = normalizeProviderPayload(payload);
  if (nodes.length === 0) throw new ObservationError("normalization");
  return { nodes };
}

async function runWithBudget<T>(
  promise: Promise<T>,
  remainingMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ObservationError("timeout")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class ObservationError extends Error {
  constructor(readonly stage: string) {
    super("Vision extraction returned an invalid observed structure.");
  }
}

function observationFailureStage(error: unknown): string {
  return error instanceof ObservationError ? error.stage : "unknown";
}

function normalizeProviderPayload(payload: unknown): ProviderNode[] {
  if (typeof payload !== "object" || payload === null) {
    throw new ObservationError("provider_shape");
  }
  let generatedId = 0;
  const nextId = () => `observed-${generatedId++}`;
  if (Array.isArray(payload)) {
    return payload
      .flatMap((node) => normalizeTreeNode(node, null, nextId))
      .slice(0, MAX_EXTRACTED_CHARACTER_NODES);
  }
  const raw = payload as Record<string, unknown>;
  if (Array.isArray(raw.nodes)) {
    const treeLike = raw.nodes.some((node) => {
      if (typeof node !== "object" || node === null || Array.isArray(node))
        return false;
      const candidate = node as Record<string, unknown>;
      return candidate.id === undefined || Array.isArray(candidate.children);
    });
    return treeLike
      ? raw.nodes
          .flatMap((node) => normalizeTreeNode(node, null, nextId))
          .slice(0, MAX_EXTRACTED_CHARACTER_NODES)
      : raw.nodes.flatMap(normalizeProviderNode);
  }
  return normalizeTreeNode(raw, null, nextId).slice(
    0,
    MAX_EXTRACTED_CHARACTER_NODES,
  );
}

function normalizeTreeNode(
  node: unknown,
  parentId: string | null,
  nextId: () => string,
): ProviderNode[] {
  if (typeof node !== "object" || node === null || Array.isArray(node))
    return [];
  const raw = node as Record<string, unknown>;
  const id = normalizedString(raw.id, 128) ?? nextId();
  const label = normalizedString(raw.label, 256);
  const children = Array.isArray(raw.children) ? raw.children : [];
  if (raw.kind === "root") {
    return children.flatMap((child) => normalizeTreeNode(child, null, nextId));
  }
  if (label === undefined) return [];
  if (children.length > 0 || raw.kind === "header" || raw.kind === "section") {
    return [
      ...validProviderNode({ id, parentId, kind: "section", label }),
      ...children.flatMap((child) => normalizeTreeNode(child, id, nextId)),
    ];
  }
  const value = normalizeValue(raw.value);
  return validProviderNode({
    id,
    parentId,
    kind: "field",
    label,
    control: normalizeControl(raw.control),
    ...(value === undefined ? {} : { value }),
  });
}

function normalizeProviderNode(node: unknown): ProviderNode[] {
  if (typeof node !== "object" || node === null || Array.isArray(node))
    return [];
  const raw = node as Record<string, unknown>;
  const id = normalizedString(raw.id, 128);
  const label = normalizedString(raw.label, 256);
  const parentId =
    raw.parentId === null ? null : normalizedString(raw.parentId, 128);
  if (id === undefined || label === undefined || parentId === undefined)
    return [];
  if (raw.kind === "section") {
    return validProviderNode({ id, parentId, kind: "section", label });
  }
  if (raw.kind !== "field") return [];
  const control = normalizeControl(raw.control);
  const value = normalizeValue(raw.value);
  return validProviderNode({
    id,
    parentId,
    kind: "field",
    label,
    control,
    ...(value === undefined ? {} : { value }),
  });
}

function validProviderNode(node: unknown): ProviderNode[] {
  const parsed = ProviderNodeSchema.safeParse(node);
  return parsed.success ? [parsed.data] : [];
}

function normalizedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized === "" ? undefined : normalized;
}

function normalizeControl(
  value: unknown,
): z.infer<typeof ExtractedControlSchema> {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const kind = raw.kind ?? raw.type;
  const candidate = {
    kind,
    ...(raw.constraints === undefined ? {} : { constraints: raw.constraints }),
  };
  const parsed = ExtractedControlSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { kind: "text" };
}

function normalizeValue(
  value: unknown,
): string | number | boolean | string[] | undefined {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 2_000,
    )
  ) {
    return value;
  }
  return undefined;
}

function mergeObservationFields(
  initial: { nodes: ProviderNode[] },
  repair: { nodes: ProviderNode[] },
): { nodes: ProviderNode[] } {
  const fieldIds = new Set(repair.nodes.map((node) => node.id));
  return {
    nodes: [
      ...repair.nodes,
      ...initial.nodes.filter(
        (node) => node.kind === "field" && !fieldIds.has(node.id),
      ),
    ],
  };
}

function rebuildTree(nodes: readonly ProviderNode[]): ExtractedCharacterNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) {
    throw new Error("Vision extraction contains duplicate node ids.");
  }
  const children = new Map<string, ProviderNode[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent === undefined || parent.kind !== "section") {
        throw new Error(
          "Vision extraction contains an invalid parent reference.",
        );
      }
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  for (const node of nodes) {
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId))
        throw new Error("Vision extraction contains a parent cycle.");
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  const build = (node: ProviderNode): ExtractedCharacterNode => {
    if (node.kind === "field") {
      return {
        kind: "field",
        label: node.label,
        control: node.control,
        ...(node.value === undefined ? {} : { value: node.value }),
      };
    }
    return {
      kind: "section",
      label: node.label,
      children: (children.get(node.id) ?? []).map(build),
    };
  };
  return nodes
    .filter((node) => node.parentId === null || !byId.has(node.parentId))
    .map(build);
}

function hasSection(nodes: readonly ProviderNode[]): boolean {
  return nodes.some((node) => node.kind === "section");
}

function parseJsonObject(response: string): unknown {
  const clean = response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const arrayStart = clean.indexOf("[");
  const objectStart = clean.indexOf("{");
  const start = [arrayStart, objectStart]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (start === undefined) throw new Error("No JSON payload found.");
  const complete = extractBalancedJson(clean, start);
  if (complete !== null) return JSON.parse(complete);
  // A model can omit the enclosing array's final bracket after completing the
  // root object. Recover that complete object, never incomplete JSON.
  const nestedObject = clean.indexOf("{", start + 1);
  if (nestedObject < 0) throw new Error("No complete JSON payload found.");
  const recovered = extractBalancedJson(clean, nestedObject);
  if (recovered === null) throw new Error("No complete JSON payload found.");
  return JSON.parse(recovered);
}

function extractBalancedJson(source: string, start: number): string | null {
  const opening = source[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (closing === null) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function countNodes(nodes: readonly ExtractedCharacterNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + 1 + (node.kind === "section" ? countNodes(node.children) : 0),
    0,
  );
}
function countSections(nodes: readonly ExtractedCharacterNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "section" ? 1 + countSections(node.children) : 0),
    0,
  );
}
function countFields(nodes: readonly ExtractedCharacterNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "field" ? 1 : countFields(node.children)),
    0,
  );
}
function maxDepth(nodes: readonly ExtractedCharacterNode[], depth = 1): number {
  if (nodes.length === 0) return 0;
  return Math.max(
    ...nodes.map((node) =>
      node.kind === "section"
        ? Math.max(depth, maxDepth(node.children, depth + 1))
        : depth,
    ),
  );
}

async function dataUri(page: Blob): Promise<string> {
  const bytes = new Uint8Array(await page.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${page.type || "image/jpeg"};base64,${btoa(binary)}`;
}
