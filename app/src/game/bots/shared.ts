// Helpers the bot player and the bot decider share (docs/game-rules.md section 11).
// Everything is computed from the live game state, so bots never read stale numbers.
import { randomInt } from '../rng';
import { isWall, milesFor } from '../cardinfo';
import type { BotMemory } from '../contracts';
import type { CardId, Difficulty, GameState, Seat } from '../types';

/** A whole number from min to max from the game's seeded generator. Bots advance state.rng. */
export const roll = (state: Readonly<GameState>, min: number, max: number): number => randomInt(state, min, max);

export const isBot = (state: Readonly<GameState>, seat: Seat): boolean => state.seats[seat]?.bot != null;
export const nameOf = (state: Readonly<GameState>, seat: Seat): string => String(state.seats[seat]?.name ?? '').trim();

/** How many sections of `kind` a seat has built. */
export function wallCount(state: Readonly<GameState>, seat: Seat, kind: CardId): number {
  return (state.seats[seat]?.walls ?? []).filter(w => w === kind).length;
}

/** Live miles for a seat: 1 → 3, 2 → 8, 3 → 16 per kind. */
export function milesOf(state: Readonly<GameState>, seat: Seat): number {
  const counts = new Map<CardId, number>();
  for (const w of state.seats[seat]?.walls ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  let total = 0;
  for (const n of counts.values()) total += milesFor(n);
  return total;
}

/** What building one more section of a kind is worth to a bot by its own count: 0 → 3, 1 → 5, 2 → 8, 3 → 0. */
export const buildGain = (count: number): number => (count === 0 ? 3 : count === 1 ? 5 : count === 2 ? 8 : 0);

/** Opponents still in the game, in seat order (the old game scanned seats 1 … Game Players). */
export function opponentsInOrder(state: Readonly<GameState>, seat: Seat): Seat[] {
  return state.seats.map((_, s) => s).filter(s => s !== seat && !state.seats[s]!.left);
}

/**
 * Hard bots size up the table (`ai think` step 1):
 * lead   = opponent with the highest miles + aiRate(name, miles) / 3
 * threat = highest aiRate(name, debt) among human opponents
 * Uses live miles (the old game read a display list that could be stale).
 */
export function sizeUp(state: Readonly<GameState>, seat: Seat, memory: BotMemory): { lead: Seat; threat: number } {
  let lead = -1, pick = -1, threat = 0;
  for (const s of opponentsInOrder(state, seat)) {
    const score = milesOf(state, s) + memory.rate(nameOf(state, s), 'miles') / 3;
    if (score > pick) { pick = score; lead = s; }
    if (!isBot(state, s)) threat = Math.max(threat, memory.rate(nameOf(state, s), 'debt'));
  }
  return { lead, threat };
}

/** Does the seat own a built pair (exactly 2 of a kind) without a Trump Train guard? */
export function hasUnguardedPair(state: Readonly<GameState>, seat: Seat): boolean {
  const kinds = new Set((state.seats[seat]?.walls ?? []).filter(isWall));
  for (const k of kinds) {
    if (wallCount(state, seat, k) === 2 && !state.trainGuards.some(g => g.seat === seat && g.kind === k)) return true;
  }
  return false;
}

export const level = (state: Readonly<GameState>, seat: Seat): Difficulty => state.seats[seat]?.bot ?? 'hard';
