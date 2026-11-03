// What one player may see. Online, the host sends each player only their own view, so other
// players' hands, the order of the draw pile and the random seed stay secret (owner decision #6).
import type { CardLocation, GameEvent, GameState, Seat } from '../types';

/** The card back (card 4), shown in place of hidden cards. */
export const CARD_BACK = 4;

export function viewFor(state: GameState, viewer: Seat, allHands = false): GameState {
  const v = JSON.parse(JSON.stringify(state)) as GameState;
  v.rng = 0;
  v.draw = v.draw.map(() => CARD_BACK);
  // A resolving card has left a hand but is not public until its event reveals it.
  v.resolving = v.resolving?.map(() => CARD_BACK);
  if (!allHands) v.seats.forEach((s, i) => { if (i !== viewer) s.hand = s.hand.map(() => CARD_BACK); });
  v.seats.forEach((s, i) => { if (i !== viewer && s.quarantine) s.quarantine = CARD_BACK; });
  return v;
}

/** Hide which cards another player drew or was dealt, and any card that moves only between places the viewer can't see. */
export function redactEvent(e: GameEvent, viewer: Seat): GameEvent {
  const hideDraw = (e.type === 'draw' || e.type === 'deal') && e.seat !== viewer;
  const cards = hideDraw && e.cards ? e.cards.map(() => CARD_BACK) : e.cards;
  // The card an event names (a played card) is public. Otherwise a card's face is seen when it leaves or
  // reaches a face-up place: the piles, the walls, a held card, or the viewer's own hand.
  const named = hideDraw ? undefined : e.card;
  const seen = (l: CardLocation) => l.zone === 'discard' || l.zone === 'jail' || l.zone === 'wall' || l.zone === 'limit'
    || l.zone === 'quarantine' || l.zone === 'trainGuard' || (l.zone === 'hand' && l.seat === viewer);
  // An instance id is only a rendering token, but keeping an id for a hidden card across events
  // would let a remote client follow it through a shuffle. Rotate it whenever its face is hidden.
  const moves = e.moves?.map((move, index) => {
    const hidden = move.card !== named && !seen(move.from) && !seen(move.to);
    return hidden ? { ...move, card: CARD_BACK, instance: 'hidden-' + index } : move;
  });
  return { ...e, ...(cards ? { cards } : {}), ...(moves ? { moves } : {}) };
}
