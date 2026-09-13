/**
 * Deterministic per-draft randomness used by surface-level rerolls. The
 * algorithm family intentionally matches `deterministic.ts` in
 * `@repo/character-sheet-generation` (FNV-1a string hash + mulberry32) so a
 * "same seed, same surface" reroll reproduces exactly the same values on every
 * supported runtime, with no `Math.random` and no network provider.
 */

/** A stable non-cryptographic string hash returning a 32-bit unsigned integer. */
export function stableDraftSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic 32-bit PRNG (mulberry32); the stream depends only on the seed. */
export type SeededRandom = () => number;

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
