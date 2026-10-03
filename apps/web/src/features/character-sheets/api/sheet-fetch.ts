/**
 * Narrow fetch shape for the same-origin character-sheet API clients. Kept in
 * its own module so the V2 client and the proxy share one transport type
 * without depending on the client implementation.
 */
export interface SheetFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}
