/**
 * Canvas selection model (14.9). UI-only: never persisted, never sent to the
 * store. `null` means the sheet overview (acts as the Root/Sheet inspector
 * context without a selection accent).
 */
export type CanvasSelection =
  { kind: "field"; key: string } | { kind: "section"; key: string } | null;
