"use client";

import { useSyncExternalStore } from "react";
import type { SheetStoreV2 } from "../state/sheet-store-v2-types";

/**
 * React binding for the vanilla V2 `SheetStoreV2`: the store stays the
 * single source of truth and React only subscribes.
 */
export function useSheetStoreV2(
  store: SheetStoreV2,
): ReturnType<SheetStoreV2["getState"]> {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
