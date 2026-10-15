/**
 * Canvas selection model (14.9, extended 14.13 with slot selection). UI-only:
 * never persisted, never sent to the store. `null` means the sheet overview
 * (acts as the Root/Sheet inspector context without a selection accent).
 */
export type CanvasNodeKind = "field" | "section" | "slot";

export type CanvasSelection =
  | { kind: "field"; key: string }
  | { kind: "section"; key: string }
  | { kind: "slot"; key: string }
  | null;
