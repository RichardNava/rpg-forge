/**
 * Neutral deterministic-generation primitives shared by the provider-free parts
 * of character-sheet generation: the standalone name source and the seeded NPC
 * value population. They are dependency- and crypto-free, reproducible on every
 * supported runtime, and never use Math.random or any network provider.
 */

/** A stable non-cryptographic string hash returning a 32-bit unsigned integer. */
export function stableNameSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic 32-bit PRNG (mulberry32). The stream depends only on the
 * supplied seed, so generation is reproducible on every runtime without
 * crypto or Math.random.
 */
export type DeterministicRandom = () => number;

export function createDeterministicRandom(seed: number): DeterministicRandom {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}