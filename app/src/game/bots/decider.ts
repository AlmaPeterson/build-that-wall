// How bots answer the questions cards ask them (docs/game-rules.md sections 8, 9 and 11).
// Answers are recomputed from the live state when asked, never remembered from the think step,
// so the decider and the player can't drift apart. Randomness comes from the game's seeded generator.
import { cardValue, isWall } from '../cardinfo';
import type { BotMemory } from '../contracts';
import type { Answer, CardId, Decider, Decision, GameState, Seat, WallRef } from '../types';
import { buildGain, level, milesOf, roll, sizeUp, wallCount } from './shared';

const TARGET_LEADER: readonly CardId[] = [9, 16, 17];     // Democrat Border, Puppeteer, Quarantine
const TARGET_CARDS: readonly CardId[] = [6, 21, 49];      // Controlled Opposition, Stimulus Check, Hand Swap
const STOP_WORDS = ['stop', 'done', 'cancel', 'no', 'skip'];

// `seat` is the bot this decider answers for; decisions always name the asked seat too (d.seat).
export function createBotDecider(_seat: Seat, memory: BotMemory): Decider {
  return {
    decide<D extends Decision>(d: D, state: Readonly<GameState>): Promise<Answer<D>> {
      return Promise.resolve(answer(d, state, memory) as Answer<D>);
    },
  };
}

/** The bot's answer to one decision. Exported for tests and for the tutorial's hints. */
export function answer(d: Decision, state: Readonly<GameState>, memory: BotMemory): unknown {
  const lvl = level(state, d.seat);
  switch (d.kind) {
    // Self-Defense and Savings: Easy uses them half the time, Medium and Hard always
    case 'block':
    case 'paySavings':
      return !(lvl === 'easy' && roll(state, 1, 2) === 1);

    case 'chooseSeat':
      return chooseSeat(state, d.card, d.options);

    case 'chooseWall': {
      if (!d.options.length) return null;
      if (d.card === 7) return debtTarget(state, d.seat, d.options, memory);
      if (d.card === 2 || d.card === 15) return weakestWall(state, d.options);   // Afghanistan, Riot: give up the weakest
      return d.options[0];                                                        // Trump Train pair, Spy Balloon guard: the first
    }

    case 'chooseHandCard': {
      const hand = state.seats[d.seat]?.hand ?? [];
      if (!d.options.length) return null;
      if (d.purpose === 'build') return wallSlot(state, d.seat, hand, d.options);   // free builds never stop early
      return giveSlot(hand, d.options, d.to === d.seat);
    }

    case 'pickCards':
      return poolPick(d.pool, d.max);

    case 'chooseOption':
      return chooseOption(state, d.seat, d.card, d.options);
  }
}

/** `ai target`: highest score wins, first seat on ties. */
function chooseSeat(state: Readonly<GameState>, card: CardId, options: Seat[]): Seat | null {
  if (!options.length) return null;
  const hand = (s: Seat) => state.seats[s]?.hand ?? [];
  const score = (s: Seat): number => {
    if (card === 2) return -milesOf(state, s);                                  // Afghanistan: give to the fewest miles
    if (TARGET_CARDS.includes(card)) return hand(s).length || -500;             // most cards in hand
    if (card === 5) return hand(s).filter(c => c === 25 || c === 26).length || -500;   // most Trump / Trump Train
    return milesOf(state, s);                                                    // the leader (9, 16, 17 and anything else)
  };
  let best = -999, pick: Seat | null = null;
  for (const s of [...options].sort((a, b) => a - b)) {
    const v = score(s);
    if (v > best) { best = v; pick = s; }
  }
  return pick;
}

/** Debt: the wall worth most to the bot by its own count of that kind (Hard +4 on the leader). Easy: random. */
function debtTarget(state: Readonly<GameState>, me: Seat, options: WallRef[], memory: BotMemory): WallRef {
  const lvl = level(state, me);
  if (lvl === 'easy') return options[roll(state, 1, options.length) - 1]!;
  const lead = lvl === 'hard' ? sizeUp(state, me, memory).lead : -1;
  let best = -1, pick = options[0]!;
  for (const w of options) {
    const gain = buildGain(wallCount(state, me, w.kind)) + (lvl === 'hard' && w.seat === lead ? 4 : 0);
    if (gain > best) { best = gain; pick = w; }
  }
  return pick;
}

/** `ai weakest wall`: the section with the fewest copies built, first on ties. */
function weakestWall(state: Readonly<GameState>, options: WallRef[]): WallRef {
  let best = 99, pick = options[0]!;
  for (const w of options) {
    const n = wallCount(state, w.seat, w.kind);
    if (n < best) { best = n; pick = w; }
  }
  return pick;
}

/** `ai wall slot`: the wall card worth most by own count (0 → 3, 1 → 5, 2 → 8, else 1). */
function wallSlot(state: Readonly<GameState>, me: Seat, hand: CardId[], options: number[]): number {
  let best = -1, pick = options[0]!;
  for (const i of options) {
    const c = hand[i]!;
    if (!isWall(c)) continue;
    const n = wallCount(state, me, c);
    const v = n === 0 ? 3 : n === 1 ? 5 : n === 2 ? 8 : 1;
    if (v > best) { best = v; pick = i; }
  }
  return pick;
}

/** `ai give slot`: keep the most valuable card for yourself, give the least valuable to others. */
function giveSlot(hand: CardId[], options: number[], self: boolean): number {
  let best = 0, pick = options[0]!;
  for (const i of options) {
    const v = self ? cardValue(hand[i]!) : 10 - cardValue(hand[i]!);
    if (v > best) { best = v; pick = i; }
  }
  return pick;
}

/** `ai pool pick`: the N most valuable cards, first in the pool on ties. */
function poolPick(pool: CardId[], max: number): CardId[] {
  const rest = [...pool], picks: CardId[] = [];
  for (let n = 0; n < max && rest.length; n++) {
    let best = -1, at = 0;
    rest.forEach((c, i) => { if (cardValue(c) > best) { best = cardValue(c); at = i; } });
    picks.push(rest.splice(at, 1)[0]!);
  }
  return picks;
}

function chooseOption(state: Readonly<GameState>, me: Seat, card: CardId, options: string[]): string | null {
  if (!options.length) return null;
  const has = (o: string) => options.includes(o);
  const lvl = level(state, me);
  if (card === 25 && has('protect')) {
    // Trump Train: protect the first unguarded pair, except Easy half the time; otherwise draw 3
    const protect = !(lvl === 'easy' && roll(state, 1, 2) === 1);
    return protect ? 'protect' : (has('draw') ? 'draw' : 'protect');
  }
  const remove = has('remove') ? 'remove' : has('train') ? 'train' : null;
  if (card === 5 && remove) {
    // Spy Balloon: remove a train if no opponent holds a Trump card, or on a 1-in-2 roll; else take
    const anyTrump = state.seats.some((s, i) => i !== me && !s.left && s.hand.some(c => c === 25 || c === 26));
    if (!anyTrump || roll(state, 1, 2) === 1) return remove;
    return has('take') ? 'take' : remove;
  }
  // Toilet Paper and anything else: never stop early, take the first real option (id order for kinds)
  return options.find(o => !STOP_WORDS.includes(o.toLowerCase())) ?? options[0]!;
}
