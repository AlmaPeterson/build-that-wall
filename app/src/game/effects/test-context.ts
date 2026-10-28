// An in-memory EffectContext for testing card effects without the engine.
// Decisions are answered by a script: per decision kind, a queue of answers (or functions), falling
// back to a default (first option, don't block, pick the first `max` cards).
import { cardById } from '../../data/cards';
import type { EffectContext } from '../contracts';
import { milesFor } from '../cardinfo';
import { insertionShuffle, nextRandom, randomInt } from '../rng';
import { DEFAULT_SETTINGS, type CardId, type Decision, type GameEvent, type GameState, type Seat, type SeatState, type WallRef } from '../types';

export interface SeatSetup { hand?: CardId[]; walls?: CardId[]; bot?: SeatState['bot']; left?: boolean; name?: string }

export function makeState(seats: SeatSetup[], extra: Partial<GameState> = {}): GameState {
  return {
    settings: { ...DEFAULT_SETTINGS, players: seats.length, bots: 0 },
    rng: 12345,
    seats: seats.map((s, i) => ({
      name: s.name ?? 'P' + (i + 1), bot: s.bot ?? null, hand: [...(s.hand ?? [])], walls: [...(s.walls ?? [])],
      skipNext: false, skipBy: 0, limitNext: 0, left: s.left ?? false,
    })),
    draw: [], discard: [], jail: [], jailRelease: 0, trainGuards: [],
    turn: 0, turnCount: 1, actionsLeft: 3, exhaustCount: 0, exhaustPending: 0,
    final: null, deckDone: false, over: null,
    ...extra,
  };
}

type Scripted = unknown | ((d: Decision) => unknown);
export type Script = Partial<Record<Decision['kind'], Scripted[]>>;

export interface TestContext extends EffectContext {
  events: GameEvent[];
  asked: Decision[];
  /** Answers queued per decision kind; shift()ed as decisions come in. */
  script: Script;
}

function defaultAnswer(d: Decision): unknown {
  switch (d.kind) {
    case 'block': case 'paySavings': return false;
    case 'chooseSeat': case 'chooseWall': case 'chooseHandCard': case 'chooseOption': return d.options[0] ?? null;
    case 'pickCards': return d.pool.slice(0, d.max);
  }
}

export function makeContext(state: GameState, player: Seat, card: CardId, script: Script = {}): TestContext {
  const events: GameEvent[] = [];
  const asked: Decision[] = [];
  const seat = (s: Seat) => state.seats[s]!;
  const isGuarded = (w: WallRef) => state.trainGuards.some(g => g.seat === w.seat && g.kind === w.kind);
  const wallCount = (s: Seat, kind: CardId) => seat(s).walls.filter(k => k === kind).length;
  const activeSeats = () => state.seats.flatMap((s, i) => (s.left ? [] : [i]));
  const trainCheck = () => {
    for (let i = state.trainGuards.length - 1; i >= 0; i--) {
      const g = state.trainGuards[i]!;
      if (wallCount(g.seat, g.kind) >= 3) { state.trainGuards.splice(i, 1); state.discard.push(25); }
    }
  };
  const ctx: TestContext = {
    state, player, card, events, asked, script,
    emit: e => { events.push(e); },
    async decide(d) {
      asked.push(d);
      const q = script[d.kind];
      const next = q && q.length ? q.shift() : undefined;
      const a = next === undefined ? defaultAnswer(d) : typeof next === 'function' ? (next as (d: Decision) => unknown)(d) : next;
      return a as never;
    },
    random: () => nextRandom(state),
    randomInt: (min, max) => randomInt(state, min, max),
    shuffleDraw: () => { state.draw = insertionShuffle(state, state.draw); },
    activeSeats,
    opponents: s => { const a = activeSeats(), n = state.seats.length, out: Seat[] = [];
      for (let k = 1; k < n; k++) { const t = (s + k) % n; if (a.includes(t)) out.push(t); } return out; },
    difficulty: s => seat(s).bot,
    draw(s, n) {
      const got: CardId[] = [];
      for (let i = 0; i < n; i++) {
        if (!state.draw.length && state.discard.length) { state.draw = insertionShuffle(state, state.discard); state.discard = []; }
        const c = state.draw.pop();
        if (c === undefined) break;
        seat(s).hand.push(c); got.push(c);
      }
      return got;
    },
    takeFromHand(s, slot) {
      const c = seat(s).hand.splice(slot, 1)[0];
      if (c === undefined) throw new Error('No card in slot ' + slot);
      return c;
    },
    addToHand: (s, c) => { seat(s).hand.push(c); },
    discard: c => { state.discard.push(c); },
    spendActions: n => { state.actionsLeft = Math.max(0, state.actionsLeft - n); },
    addActions: n => { state.actionsLeft += n; },
    buildFree(s, slot) {
      const c = ctx.takeFromHand(s, slot);
      if (!cardById(c) || c < 29 || c > 44) throw new Error('Not a wall: ' + c);
      seat(s).walls.push(c);
      events.push({ type: 'build', seat: s, card: c, text: 'built' });
      trainCheck();
    },
    wallCount,
    eligibleWalls: s => [...new Set(seat(s).walls)].sort((a, b) => a - b)
      .filter(kind => wallCount(s, kind) < 3 && !isGuarded({ seat: s, kind })).map(kind => ({ seat: s, kind })),
    moveWall(from, to) {
      const at = seat(from.seat).walls.indexOf(from.kind);
      if (at < 0) throw new Error('No such wall');
      seat(from.seat).walls.splice(at, 1);
      if ('walls' in to) seat(to.walls).walls.push(from.kind); else seat(to.hand).hand.push(from.kind);
      trainCheck();
    },
    isGuarded,
    miles: s => { let m = 0; for (let k = 29; k <= 44; k++) m += milesFor(wallCount(s, k)); return m; },
    async defend(target, attacker, c) {
      const at = seat(target).hand.indexOf(20);
      if (at < 0) return false;
      if (!(await ctx.decide({ kind: 'block', seat: target, attacker, card: c }))) return false;
      seat(target).hand.splice(seat(target).hand.indexOf(20), 1);
      state.discard.push(20);
      events.push({ type: 'blocked', seat: target, target: attacker, card: c, text: 'blocked' });
      return true;
    },
    trainCheck,
  };
  return ctx;
}

/** Count copies of each card, for comparing piles regardless of order. */
export const counts = (cards: CardId[]): Record<number, number> =>
  cards.reduce<Record<number, number>>((m, c) => { m[c] = (m[c] ?? 0) + 1; return m; }, {});
