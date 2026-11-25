// A bot strategy as numbers, so it can be tuned by playing games (tools/train-bot.ts) instead of by hand.
// On its turn the bot scores every move it could make (each way to build, each card it can play) with these
// numbers and makes the best one; when nothing scores above `minValue` it ends its turn. The Extra Hard bot
// plays the strategy the trainer learned (learned.json), and uses it in its practice games too.
import { isWall } from '../cardinfo';
import type { BotMemory, GameApi } from '../contracts';
import type { Action, CardId, GameState, Seat } from '../types';
import { hasUnguardedPair, milesOf, opponentsInOrder, wallCount } from './shared';
import learned from './learned.json';

export interface Strategy {
  /** Building a wall when you already have 0, 1 or 2 of that kind (2 → 3 finishes a set: 16 miles, safe). */
  build: [number, number, number];
  /** Taken off a build paid with 2 other wall cards instead of a Man Hour (those walls are gone). */
  payWalls: number;
  /** Playing each card (Debt and Trump Train have their own numbers below). Cards not listed: `otherCard`. */
  cards: Record<number, number>;
  otherCard: number;
  /** Debt, per mile the best opponent is ahead of you (plus `debtBase`). */
  debtBase: number;
  debtPerMileBehind: number;
  /** Trump Train when you have a built pair it could guard, and when you don't. */
  trainWithPair: number;
  trainWithout: number;
  /** Nothing above this: end the turn and keep the cards. */
  minValue: number;
}

/** Where training starts: close to the Hard bot (build first, then Debt, then cards in Hard's order). */
export const STARTING_STRATEGY: Strategy = {
  build: [3, 6, 20],
  payWalls: 0,
  cards: { 3: 2.8, 13: 2.6, 28: 2.5, 23: 2.4, 21: 2.3, 6: 2.2, 5: 2.1, 16: 2.0, 17: 1.9, 9: 1.8, 26: 1.7, 22: 1.6, 27: 1.5, 11: 1.4, 47: 1.3, 45: 1.2, 48: 1.1, 49: 1.0 },
  otherCard: 0.5,
  debtBase: 2.9,
  debtPerMileBehind: 0,
  trainWithPair: 3.5,
  trainWithout: 0.2,
  minValue: 0,
};

/** The strategy the trainer learned (tools/train-bot.ts): Hard bots play it, Extra Hard bots build on it. */
export const LEARNED: Strategy = learned as unknown as Strategy;

const DEBT = 7, TRUMP_TRAIN = 25, GIVE_IT_ALL_AWAY = 46;

function leadOverMe(state: Readonly<GameState>, seat: Seat): number {
  const best = Math.max(0, ...opponentsInOrder(state, seat).map(s => milesOf(state, s)));
  return best - milesOf(state, seat);
}

/** What each possible move is worth to `seat` under `w`. */
export function scoreMoves(api: GameApi, seat: Seat, w: Strategy): { action: Action; value: number }[] {
  const state = api.state, hand = state.seats[seat]?.hand ?? [];
  const out: { action: Action; value: number }[] = [];
  for (const o of api.buildOptions(seat)) {
    const kind = hand[o.slot]!;
    if (!isWall(kind)) continue;
    const have = wallCount(state, seat, kind);
    if (have >= 3) continue;
    const paidWithWalls = 'walls' in o.pay;
    out.push({ action: { type: 'build', slot: o.slot, pay: o.pay }, value: w.build[have as 0 | 1 | 2] - (paidWithWalls ? w.payWalls : 0) });
  }
  const behind = Math.max(0, leadOverMe(state, seat));
  hand.forEach((c, slot) => {
    if (c === GIVE_IT_ALL_AWAY || !api.canPlay(seat, slot).ok) return;
    let value: number;
    if (c === DEBT) {
      if (!api.debtTargets(seat).length) return;
      value = w.debtBase + w.debtPerMileBehind * behind;
    } else if (c === TRUMP_TRAIN) value = hasUnguardedPair(state, seat) ? w.trainWithPair : w.trainWithout;
    else value = w.cards[c] ?? w.otherCard;
    out.push({ action: { type: 'play', slot }, value });
  });
  return out;
}

/** The move this strategy makes now: the best-scoring one, or ending the turn. */
export function thinkWith(api: GameApi, seat: Seat, _memory: BotMemory, w: Strategy): Action {
  if (api.state.actionsLeft < 1) return { type: 'endTurn' };
  let best: Action = { type: 'endTurn' }, bestValue = w.minValue;
  for (const m of scoreMoves(api, seat, w)) if (m.value > bestValue) { best = m.action; bestValue = m.value; }
  return best;
}

/** The numbers as a flat list (for training) and back. */
export const CARD_IDS: readonly CardId[] = [3, 5, 6, 9, 11, 13, 16, 17, 21, 22, 23, 26, 27, 28, 45, 47, 48, 49];
export function toVector(w: Strategy): number[] {
  return [...w.build, w.payWalls, ...CARD_IDS.map(c => w.cards[c] ?? w.otherCard), w.otherCard, w.debtBase, w.debtPerMileBehind, w.trainWithPair, w.trainWithout, w.minValue];
}
export function fromVector(v: readonly number[]): Strategy {
  let i = 0;
  const next = () => v[i++]!;
  const build: [number, number, number] = [next(), next(), next()];
  const payWalls = next();
  const cards: Record<number, number> = {};
  for (const c of CARD_IDS) cards[c] = next();
  return { build, payWalls, cards, otherCard: next(), debtBase: next(), debtPerMileBehind: next(), trainWithPair: next(), trainWithout: next(), minValue: next() };
}
