// A small stand-in for the engine, only for the bot tests: builds a GameState and answers
// GameApi questions with simple versions of the rules (sections 5, 6 and 9 of docs/game-rules.md).
import { actionCost, isWall } from '../cardinfo';
import type { BotMemory, GameApi } from '../contracts';
import { DEFAULT_SETTINGS, type BuildPayment, type CardId, type Difficulty, type GameState, type Seat, type WallRef } from '../types';
import { milesOf, wallCount } from './shared';

export interface SeatSpec { bot?: Difficulty | null; hand?: CardId[]; walls?: CardId[]; name?: string; left?: boolean }

export function makeState(seats: SeatSpec[], opts: Partial<GameState> = {}): GameState {
  return {
    settings: { ...DEFAULT_SETTINGS, players: seats.length, bots: seats.filter(s => s.bot).length },
    rng: 12345,
    seats: seats.map((s, i) => ({
      name: s.name ?? (s.bot ? 'Bot ' + (i + 1) : 'Player ' + (i + 1)),
      bot: s.bot ?? null, hand: [...(s.hand ?? [])], walls: [...(s.walls ?? [])],
      skipNext: false, skipBy: 0, limitNext: 0, left: !!s.left,
    })),
    draw: [30, 31, 32], discard: [33], jail: [], jailRelease: 0, trainGuards: [],
    turn: 0, turnCount: 1, actionsLeft: 3, exhaustCount: 0, exhaustPending: 0,
    final: null, deckDone: false, over: null,
    ...opts,
  };
}

/** Cards that fail `fx check` can be listed per test; everything else passes. */
export function makeApi(state: GameState, unplayable: CardId[] = []): GameApi {
  const api: GameApi = {
    state,
    canPlay(seat, slot) {
      const c = state.seats[seat]!.hand[slot];
      if (c === undefined || isWall(c)) return { ok: false, reason: 'not a card to play' };
      if (actionCost(c) > state.actionsLeft) return { ok: false, reason: 'no actions' };
      if (c === 46 && state.seats[seat]!.bot) return { ok: false, reason: 'bots never play it' };
      if (unplayable.includes(c)) return { ok: false, reason: 'test says no' };
      return { ok: true };
    },
    buildOptions(seat) {
      if (state.actionsLeft < 1) return [];
      const hand = state.seats[seat]!.hand;
      const out: { slot: number; pay: Exclude<BuildPayment, 'free'> }[] = [];
      const mh = hand.indexOf(14);
      hand.forEach((c, i) => {
        if (!isWall(c)) return;
        if (mh >= 0) out.push({ slot: i, pay: { manHour: mh } });
        const others = hand.map((x, j) => (isWall(x) && j !== i ? j : -1)).filter(j => j >= 0);
        if (others.length >= 2) out.push({ slot: i, pay: { walls: [others[0]!, others[1]!] } });
      });
      return out;
    },
    debtTargets(seat) {
      const out: WallRef[] = [];
      state.seats.forEach((s, o) => {
        if (o === seat || s.left) return;
        for (const kind of new Set(s.walls)) {
          if (wallCount(state, o, kind) < 3 && !state.trainGuards.some(g => g.seat === o && g.kind === kind)) out.push({ seat: o, kind });
        }
      });
      return out;
    },
    trainPairs(seat) {
      return [...new Set(state.seats[seat]!.walls)].filter(k => wallCount(state, seat, k) === 2 &&
        !state.trainGuards.some(g => g.seat === seat && g.kind === k)).map(kind => ({ seat, kind }));
    },
    miles: (seat: Seat) => milesOf(state, seat),
    sets: (seat: Seat) => [...new Set(state.seats[seat]!.walls)].filter(k => wallCount(state, seat, k) >= 3).length,
    act: async () => ({ ok: true }),
  };
  return api;
}

/** Memory with fixed rates per name. */
export function fixedMemory(rates: Record<string, { miles?: number; debt?: number }> = {}): BotMemory {
  return {
    learn() {},
    rate: (name, what) => rates[name]?.[what] ?? 0,
  };
}

/** A key-value store in memory. */
export function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); }, map: m };
}
