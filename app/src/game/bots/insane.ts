// The Extra Hard bot (id 'insane', a Gold level): it starts from the strategy learned in the bots' simulator
// (the Hard bot's), and before each move it tries every move it could make in quick practice games, where
// every player plays that learned strategy, and picks the one that turned out best. It plays fair: in the practice games the cards it can't
// see (other players' hands and the draw pile) are shuffled again, so it never uses hidden cards.
import { cardRules } from '../effects';
import type { BotMemory, GameApi } from '../contracts';
import { Game } from '../engine/game';
import type { Action, CardId, Decider, GameState, Seat } from '../types';
import { createBotDecider } from './decider';
import { LEARNED, thinkWith } from './strategy';
import { milesOf } from './shared';

const GIVE_IT_ALL_AWAY = 46;

/**
 * How hard a bot thinks: how many practice games it plays per move, how many turns each looks ahead, and how
 * many miles (on average) a move must win by in practice to be picked over the learned strategy's own choice.
 */
export interface Lookahead { games: number; turns: number; margin: number }
/** How hard Extra Hard bots think (about a second a move at most on a phone). */
export const EXTRA_HARD_LOOK: Lookahead = { games: 12, turns: 4, margin: 2 };
/** Most moves compared at once (the Hard choice is always one of them). */
const MAX_MOVES = 6;

class Stop extends Error {}

/** A small seeded generator for the reshuffles, so a game still replays the same way. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The moves worth comparing: the learned strategy's choice, each build that pays differently, each card, and ending the turn. */
export function candidateMoves(api: GameApi, seat: Seat, memory: BotMemory): Action[] {
  const state = api.state, hand = state.seats[seat]?.hand ?? [];
  const out: Action[] = [];
  const seen = new Set<string>();
  const add = (a: Action, key: string) => { if (!seen.has(key)) { seen.add(key); out.push(a); } };
  const hard = thinkWith(api, seat, memory, LEARNED);
  add(hard, keyOf(hard, hand));
  for (const o of api.buildOptions(seat)) {
    const a: Action = { type: 'build', slot: o.slot, pay: o.pay };
    add(a, keyOf(a, hand));
  }
  hand.forEach((c, slot) => {
    if (c === GIVE_IT_ALL_AWAY || !api.canPlay(seat, slot).ok) return;
    const a: Action = { type: 'play', slot };
    add(a, keyOf(a, hand));
  });
  add({ type: 'endTurn' }, 'end');
  return out.slice(0, MAX_MOVES + 1);
}

/** Two moves are the same if they use the same kinds of cards in the same way. */
function keyOf(a: Action, hand: CardId[]): string {
  if (a.type === 'endTurn') return 'end';
  if (a.type === 'play') return 'p' + hand[a.slot];
  const pay = a.pay === 'free' ? 'f' : 'manHour' in a.pay ? 'm' : 'w' + [hand[a.pay.walls[0]], hand[a.pay.walls[1]]].sort().join(',');
  return 'b' + hand[a.slot] + pay;
}

/** A copy of the game as this seat knows it: other hands and the draw pile shuffled together and dealt again. */
export function guessState(state: Readonly<GameState>, me: Seat, random: () => number): GameState {
  const s: GameState = JSON.parse(JSON.stringify(state));
  const others = s.seats.map((_, i) => i).filter(i => i !== me);
  const pool = [...s.draw, ...others.flatMap(i => s.seats[i]!.hand)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  for (const i of others) {
    const n = s.seats[i]!.hand.length;
    s.seats[i]!.hand = pool.splice(0, n);
  }
  s.draw = pool;
  // Everyone in the practice game is a Hard bot that doesn't learn
  for (const seat of s.seats) if (!seat.left) seat.bot = 'hard';
  s.rng = Math.floor(random() * 2 ** 31);
  return s;
}

/** How good a position is for `me`: miles ahead of the best opponent, with a big bonus for having won. */
export function score(s: Readonly<GameState>, me: Seat): number {
  const mine = milesOf(s, me);
  const best = Math.max(0, ...s.seats.map((_, i) => i).filter(i => i !== me && !s.seats[i]!.left).map(i => milesOf(s, i)));
  if (s.over) return s.over.winners.includes(me) ? 1000 + mine - best : -1000 + mine - best;
  return mine - best;
}

/** Play `first` in a practice copy, then let the learned strategy play on for a few turns. */
async function practice(state: Readonly<GameState>, me: Seat, first: Action, random: () => number, memory: BotMemory, turns: number): Promise<number> {
  const s = guessState(state, me, random);
  const stopAt = s.turnCount + turns;
  let firstDone = false;
  const deciders = new Map<Seat, Decider>();
  const game = new Game(s, {
    rules: cardRules,
    bot: {
      nextAction: (api, seat) => {
        if (seat === me && !firstDone) { firstDone = true; return first; }
        return thinkWith(api, seat, memory, LEARNED);
      },
    },
    deciderFor: seat => {
      if (!deciders.has(seat)) deciders.set(seat, createBotDecider(seat, memory));
      return deciders.get(seat)!;
    },
    emit: () => {},
    beforeTurn: async () => { if (s.turnCount >= stopAt) throw new Stop(); },
  });
  try {
    await game.carryOn();
  } catch (e) {
    if (!(e instanceof Stop)) return -10000;      // a move the practice game couldn't play
  }
  return score(s, me);
}

/** The Extra Hard bot's next move. */
export async function thinkInsane(api: GameApi, seat: Seat, memory: BotMemory, look: Lookahead = EXTRA_HARD_LOOK): Promise<Action> {
  const state = api.state;
  const moves = candidateMoves(api, seat, memory);
  if (moves.length <= 1) return moves[0] ?? { type: 'endTurn' };
  const random = rng(state.rng ^ (state.turnCount * 2654435761) ^ (state.actionsLeft * 97));
  // The same reshuffles for every move, so the moves are compared fairly
  const seeds = Array.from({ length: look.games }, () => Math.floor(random() * 2 ** 31));
  // moves[0] is the Hard bot's choice: another move has to beat it clearly, not by the luck of the practice games
  let best = moves[0]!, bestScore = -Infinity, hardScore = 0;
  for (const m of moves) {
    let total = 0;
    for (const seed of seeds) total += await practice(state, seat, m, rng(seed), memory, look.turns);
    if (m === moves[0]) hardScore = total;
    if (total > bestScore) { bestScore = total; best = m; }
  }
  return bestScore - hardScore >= look.margin * look.games ? best : moves[0]!;
}
