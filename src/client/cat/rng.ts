/**
 * A small seeded random generator (mulberry32). The cat never uses Math.random: the same seed gives the same cat day, so a behaviour that
 * went wrong in a long simulated session can be replayed from its seed, and a test can pin what the cat does.
 */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [min, max) */
  range(min: number, max: number): number;
  /** An integer in [min, max] */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T | undefined;
  /** One of the items, in proportion to its weight (items with no weight are never chosen); undefined when there is nothing to choose. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined;
  /** A generator of its own, derived from this one and a name: what one part of the cat does does not change when another part draws more numbers. */
  fork(label: string): Rng;
}

const hashLabel = (label: string): number => {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (min: number, max: number) => min + (max - min) * next();
  return {
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    chance: (p) => next() < p,
    pick: (items) => (items.length === 0 ? undefined : items[Math.min(items.length - 1, Math.floor(next() * items.length))]),
    weighted: (items, weight) => {
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      if (!(total > 0)) return undefined;
      let at = next() * total;
      for (const item of items) {
        at -= Math.max(0, weight(item));
        if (at < 0) return item;
      }
      return items[items.length - 1];
    },
    fork: (label) => createRng((state ^ hashLabel(label)) >>> 0),
  };
}
