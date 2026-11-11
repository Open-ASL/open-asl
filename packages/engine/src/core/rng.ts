import type { RngState } from './types';

/**
 * xoshiro128** — small, fast, deterministic and identical on every JS runtime.
 * The state is stored in GameState so dice are reproducible from the seed.
 */

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Seed suffix for the antithetic twin of a seed's dice (`seedRng`). */
export const MIRROR = '!mirror';

/**
 * Seed from an arbitrary string (e.g. a server-generated hex seed). A seed ending in `MIRROR` gives
 * the antithetic twin of the seed without it: the same stream with every die turned over (1 for 6,
 * 2 for 5, 3 for 4), so a game and its twin have opposite luck roll for roll. Bench and search use
 * the pair to cancel luck out of comparisons; no real game seed ends that way.
 */
export function seedRng(seed: string): RngState {
  if (typeof seed === 'string' && seed.endsWith(MIRROR)) return { ...seedRng(seed.slice(0, -MIRROR.length)), mirror: true };
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  const next = splitmix32(h);
  const s: RngState['s'] = [next(), next(), next(), next()];
  if (s.every((w) => w === 0)) s[0] = 1;
  return { s };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Returns the next 32-bit output and the advanced state (pure). */
export function nextU32(rng: RngState): [number, RngState] {
  const [s0, s1, s2, s3] = rng.s;
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  let n2 = (s2 ^ s0) >>> 0;
  let n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;
  n2 = (n2 ^ t) >>> 0;
  n3 = rotl(n3, 11);
  return [result, rng.mirror ? { s: [n0, n1, n2, n3], mirror: true } : { s: [n0, n1, n2, n3] }];
}

/** Unbiased integer in [1, sides] via rejection sampling. */
export function rollDie(rng: RngState, sides = 6): [number, RngState] {
  const limit = Math.floor(0x100000000 / sides) * sides;
  let state = rng;
  for (;;) {
    const [v, next] = nextU32(state);
    state = next;
    if (v < limit) return [rng.mirror ? sides - (v % sides) : (v % sides) + 1, state];
  }
}
