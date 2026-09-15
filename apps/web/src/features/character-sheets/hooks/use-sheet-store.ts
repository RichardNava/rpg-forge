"use client";

import { useSyncExternalStore } from "react";
import type { SheetStore } from "../state/sheet-store-types";

/**
 * React binding for the vanilla `SheetStore`. The store stays the single
 * source of truth: this hook only subscribes and reads through
 * `useSyncExternalStore`, so React re-renders on store emits without ever
 * owning the state.
 */
export function useSheetStore(
  store: SheetStore,
): ReturnType<SheetStore["getState"]> {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
