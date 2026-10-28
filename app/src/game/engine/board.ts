// Pure questions about the board: miles, sets, which walls can be taken, seats, names.
import { cardById } from '../../data/cards';
import { milesFor } from '../cardinfo';
import type { CardId, GameState, Seat, WallRef } from '../types';

export const WALL_KINDS: readonly CardId[] = Array.from({ length: 16 }, (_, i) => 29 + i);

export function wallCount(state: GameState, seat: Seat, kind: CardId): number {
  let n = 0;
  for (const w of state.seats[seat]?.walls ?? []) if (w === kind) n++;
  return n;
}

/** Miles: per wall kind 1 → 3, 2 → 8, 3+ → 16 (`define calc miles`). */
export function miles(state: GameState, seat: Seat): number {
  return WALL_KINDS.reduce((sum, k) => sum + milesFor(wallCount(state, seat, k)), 0);
}

/** Kinds with 3 or more sections (`define sets of`). */
export function sets(state: GameState, seat: Seat): number {
  return WALL_KINDS.filter(k => wallCount(state, seat, k) >= 3).length;
}

export function isGuarded(state: GameState, w: WallRef): boolean {
  return state.trainGuards.some(g => g.seat === w.seat && g.kind === w.kind);
}

/** Built sections that can be taken, given away or pulled back: not in a set of 3, not guarded. One ref per kind. */
export function eligibleWalls(state: GameState, seat: Seat): WallRef[] {
  return WALL_KINDS.filter(k => {
    const n = wallCount(state, seat, k);
    return n > 0 && n < 3 && !isGuarded(state, { seat, kind: k });
  }).map(kind => ({ seat, kind }));
}

/** Built pairs (exactly 2 of a kind) not yet guarded (`define train sets`). */
export function trainPairs(state: GameState, seat: Seat): WallRef[] {
  return WALL_KINDS.filter(k => wallCount(state, seat, k) === 2 && !isGuarded(state, { seat, kind: k }))
    .map(kind => ({ seat, kind }));
}

/** Seats still in the game, in seat order. */
export function activeSeats(state: GameState): Seat[] {
  return state.seats.flatMap((s, i) => (s.left ? [] : [i]));
}

/** Other active seats, starting after `seat` and going round (clockwise). */
export function opponents(state: GameState, seat: Seat): Seat[] {
  const n = state.seats.length, out: Seat[] = [];
  for (let i = 1; i < n; i++) {
    const s = (seat + i) % n;
    if (!state.seats[s]!.left) out.push(s);
  }
  return out;
}

/** Opponent walls Debt could take: fewer than 3 of that kind and not guarded (`define debt targets`). */
export function debtTargets(state: GameState, seat: Seat): WallRef[] {
  return opponents(state, seat).flatMap(o => eligibleWalls(state, o));
}

export const seatName = (state: GameState, seat: Seat): string => state.seats[seat]?.name ?? 'Player ' + (seat + 1);
export const cardName = (id: CardId): string => cardById(id).name;
