// Seeded random numbers kept inside the game state, so a game replays exactly from its seed
// (tests, online sync, bug reports). mulberry32.
import type { GameState } from './types';

export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whole number from min to max, both included. */
export function randomInt(state: Pick<GameState, 'rng'>, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

/** True with probability p. */
export function chance(state: Pick<GameState, 'rng'>, p: number): boolean {
  return nextRandom(state) < p;
}

/** Shuffle by inserting each item at a random position, as the old game does. Returns a new array. */
export function insertionShuffle<T>(state: Pick<GameState, 'rng'>, items: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of items) out.splice(randomInt(state, 0, out.length), 0, item);
  return out;
}
