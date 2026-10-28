// What a bot does on its own turn: `ai think` (docs/game-rules.md section 11).
// The engine calls nextAction again after every action until the bot says endTurn.
// The bot only picks WHAT to do; targets and other questions come later through its Decider.
import { isWall } from '../cardinfo';
import type { BotMemory, BotPlayer, GameApi } from '../contracts';
import type { Action, BuildPayment, CardId, Difficulty, Seat } from '../types';
import { buildGain, hasUnguardedPair, level, roll, sizeUp, wallCount } from './shared';

const DEBT = 7, MAN_HOUR = 14, TRUMP_TRAIN = 25;

/** Cards bots consider playing (besides Debt), in no particular order. */
export const PLAYABLE: readonly CardId[] = [3, 5, 6, 9, 11, 13, 16, 17, 21, 22, 23, 27, 28, 45, 46, 47, 48, 49, 25, 26];

/** Hard bots play the first of these they can. */
export const HARD_PRIORITY: readonly CardId[] = [25, 3, 13, 28, 23, 21, 6, 5, 16, 17, 9, 26, 22, 27, 11, 47, 45, 48, 49];

const END: Action = { type: 'endTurn' };

export function createBotPlayer(memory: BotMemory): BotPlayer {
  return { nextAction: (api, seat) => think(api, seat, memory) };
}

/**
 * One `ai think` step. `as` overrides the difficulty (the tutorial's tips think like a Hard bot).
 * Randomness comes from the game's seeded generator, so a game replays exactly.
 */
export function think(api: GameApi, seat: Seat, memory: BotMemory, as?: Difficulty): Action {
  const state = api.state;
  const lvl = as ?? level(state, seat);
  const hand = state.seats[seat]?.hand ?? [];
  if (state.actionsLeft < 1) return END;

  const threat = lvl === 'hard' ? sizeUp(state, seat, memory).threat : 0;
  const train = lvl === 'hard' && hand.includes(TRUMP_TRAIN) && threat > 0.2 && hasUnguardedPair(state, seat);

  // Build: the wall card with the highest gain; needs a Man Hour or 3+ wall cards in hand
  const wallSlots = hand.map((c, i) => (isWall(c) ? i : -1)).filter(i => i >= 0);
  const mh = hand.indexOf(MAN_HOUR);
  let best = -1, bestGain = -1;
  for (const k of wallSlots) {
    const cnt = wallCount(state, seat, hand[k]!);
    let gain = buildGain(cnt);
    if (lvl === 'easy' && roll(state, 1, 2) === 1) gain = roll(state, 1, 8);
    if (lvl === 'medium' && roll(state, 1, 5) === 1) gain = roll(state, 1, 8);
    if (lvl === 'hard') {
      if (cnt === 2) gain = 20;
      if (cnt === 1) gain = 6 + (threat > 0.4 ? 2 : 0);
    }
    if ((mh >= 0 || wallSlots.length - 1 > 1) && gain > bestGain) { best = k; bestGain = gain; }
  }
  const build = best >= 0 && bestGain > 0 ? buildAction(api, seat, best, mh, wallSlots) : null;

  if (build && !(lvl === 'hard' && train && bestGain < 20) && !(lvl === 'easy' && roll(state, 1, 4) === 1)) return build;

  if (lvl === 'easy') {
    // Owner decision: Easy bots that CAN'T build play Debt or a card instead of passing,
    // picked at random from everything they can play (the Debt target is random too, see decider).
    // An Easy bot that could build but skipped it on its 1-in-4 roll still stops, as before.
    if (build) return END;
    const cands = hand.map((c, i) => i).filter(i => {
      const c = hand[i]!;
      if (c === DEBT) return api.debtTargets(seat).length > 0 && api.canPlay(seat, i).ok;
      return PLAYABLE.includes(c) && api.canPlay(seat, i).ok;
    });
    return cands.length ? { type: 'play', slot: cands[roll(state, 1, cands.length) - 1]! } : END;
  }

  // Debt (Medium/Hard, not while protecting a pair): the decider picks the target
  const debtSlot = hand.indexOf(DEBT);
  if (debtSlot >= 0 && !train && api.debtTargets(seat).length > 0 && api.canPlay(seat, debtSlot).ok) {
    return { type: 'play', slot: debtSlot };
  }

  // Play a card: Medium plays the first candidate in hand order, Hard follows its priority list
  const cands = hand.map((_, i) => i).filter(i => PLAYABLE.includes(hand[i]!) && api.canPlay(seat, i).ok);
  if (!cands.length) return END;
  let slot = cands[0]!;
  if (lvl === 'hard') {
    for (const id of HARD_PRIORITY) {
      const matches = cands.filter(i => hand[i] === id);
      if (matches.length) { slot = matches[matches.length - 1]!; break; }   // the old loop kept the last match
    }
  }
  return { type: 'play', slot };
}

// Pay with a Man Hour if held, else the first two other wall cards. Null if the engine says it isn't legal.
function buildAction(api: GameApi, seat: Seat, slot: number, mh: number, wallSlots: number[]): Action | null {
  let pay: Exclude<BuildPayment, 'free'>;
  if (mh >= 0) pay = { manHour: mh };
  else {
    const others = wallSlots.filter(i => i !== slot);
    if (others.length < 2) return null;
    pay = { walls: [others[0]!, others[1]!] };
  }
  const legal = api.buildOptions(seat).some(o => o.slot === slot && JSON.stringify(o.pay) === JSON.stringify(pay));
  return legal ? { type: 'build', slot, pay } : null;
}
