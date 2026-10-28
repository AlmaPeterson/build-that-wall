// What one player may see. Online, the host sends each player only their own view, so other
// players' hands, the order of the draw pile and the random seed stay secret (owner decision #6).
import type { GameEvent, GameState, Seat } from '../types';

/** The card back (card 4), shown in place of hidden cards. */
export const CARD_BACK = 4;

export function viewFor(state: GameState, viewer: Seat): GameState {
  const v = JSON.parse(JSON.stringify(state)) as GameState;
  v.rng = 0;
  v.draw = v.draw.map(() => CARD_BACK);
  v.seats.forEach((s, i) => { if (i !== viewer) s.hand = s.hand.map(() => CARD_BACK); });
  return v;
}

/** Hide which cards another player drew or was dealt. */
export function redactEvent(e: GameEvent, viewer: Seat): GameEvent {
  if ((e.type === 'draw' || e.type === 'deal') && e.seat !== viewer && e.cards) {
    return { ...e, cards: e.cards.map(() => CARD_BACK) };
  }
  return e;
}
