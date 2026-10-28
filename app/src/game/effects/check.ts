// Can a card be played right now? (Cards › define fx check; docs/game-rules.md section 6.)
// Pure: reads the state only. The action cost is checked by the engine.
import { isWall } from '../cardinfo';
import type { CardId, GameState, Seat } from '../types';

export type CheckResult = { ok: true } | { ok: false; reason: string };

const no = (reason: string): CheckResult => ({ ok: false, reason });

/** Other seats still in the game. */
const opponentsOf = (state: GameState, seat: Seat): Seat[] =>
  state.seats.flatMap((s, i) => (i !== seat && !s.left ? [i] : []));

const wallCount = (state: GameState, seat: Seat, kind: CardId): number =>
  state.seats[seat]!.walls.filter(w => w === kind).length;

const guarded = (state: GameState, seat: Seat, kind: CardId): boolean =>
  state.trainGuards.some(g => g.seat === seat && g.kind === kind);

/** Does any opponent have a built wall a Debt could take (fewer than 3 of that kind, not guarded)? */
export function hasDebtTarget(state: GameState, seat: Seat): boolean {
  return opponentsOf(state, seat).some(s =>
    state.seats[s]!.walls.some(kind => wallCount(state, s, kind) < 3 && !guarded(state, s, kind)));
}

export function check(state: GameState, seat: Seat, card: CardId): CheckResult {
  const me = state.seats[seat];
  if (!me) return no('That seat is not in the game.');
  const h = me.hand;
  const opp = opponentsOf(state, seat);
  switch (card) {
    case 3: case 13: case 28:
      return h.some(isWall) ? { ok: true } : no('You need a Wall Section in your hand.');
    case 23: {
      const pair = h.some((c, i) => isWall(c) && h.indexOf(c) !== i);
      return pair ? { ok: true } : no('You need 2 matching Wall Sections in your hand.');
    }
    case 5: {
      // Only bots are stopped from wasting it (as before); humans may always play it
      if (!me.bot) return { ok: true };
      const any = opp.some(s => state.seats[s]!.hand.some(c => c === 25 || c === 26)) ||
        state.trainGuards.some(g => g.seat !== seat && opp.includes(g.seat));
      return any ? { ok: true } : no('No opponent has a Trump card or a Trump Train.');
    }
    case 6: case 21:
      return opp.some(s => state.seats[s]!.hand.length > 0) ? { ok: true } : no('No opponent has any cards in hand.');
    case 7:
      return hasDebtTarget(state, seat) ? { ok: true }
        : no('No wall to take: Debt needs an opponent\'s built wall that is not part of a complete set of 3.');
    case 22:
      return state.draw.length ? { ok: true } : no('The draw pile is empty.');
    case 27: case 45:
      return state.discard.length ? { ok: true } : no('The discard pile is empty.');
    case 11:
      return state.draw.length + state.discard.length ? { ok: true } : no('The draw and discard piles are empty.');
    case 19: case 20:
      return no('This card is only used to block.');
    case 46:
      return h.length >= 2 && !me.bot ? { ok: true } : no('You have no other cards to hand out.');
    case 4:
      return no('This is the back of a card.');
    case 14:
      return no('Man Hours are used to build walls.');
    default:
      if (isWall(card)) return no('Wall Sections are built, not played.');
      return { ok: true };
  }
}
