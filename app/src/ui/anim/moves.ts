// Which cards moved between two views of the game, worked out by comparing them. Every card effect
// changes the state its own way, so comparing what the viewer could see before and after is simpler
// (and safer) than having every effect describe its moves. Both views are already redacted, so a card
// the viewer may not see stays a card back here too. Pure functions, so they're easy to test.
import { CARD_BACK, type CardId, type GameState, type Seat } from '../../game';

/** Where a card can be on the board. */
export type Place =
  | { at: 'hand'; seat: Seat; slot: number }
  | { at: 'walls'; seat: Seat; kind: CardId }
  | { at: 'guard'; seat: Seat; kind: CardId }   // a Trump Train protecting a pair
  | { at: 'limit'; seat: Seat }                 // Democrat Border / Puppeteer waiting for that seat's next turn
  | { at: 'seat'; seat: Seat }                  // "at that player" (cards played on them that are held nowhere)
  | { at: 'draw' } | { at: 'discard' } | { at: 'jail' } | { at: 'center' };

export interface Move {
  /** The card's face, or CARD_BACK if the viewer may not see it. */
  card: CardId;
  from: Place;
  to: Place;
}

interface Entry { card: CardId; place: Place }

/** Every card a view shows, with where it is. */
function entries(v: GameState): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  const add = (key: string, list: Entry[]) => out.set(key, list);
  v.seats.forEach((s, seat) => {
    add('hand' + seat, s.hand.map((card, slot) => ({ card, place: { at: 'hand', seat, slot } })));
    add('walls' + seat, s.walls.map(card => ({ card, place: { at: 'walls', seat, kind: card } })));
    add('limit' + seat, s.limitNext > 0 ? [{ card: s.limitNext, place: { at: 'limit', seat } }] : []);
  });
  add('guard', v.trainGuards.map(g => ({ card: 25, place: { at: 'guard', seat: g.seat, kind: g.kind } })));
  add('draw', v.draw.map(card => ({ card, place: { at: 'draw' } })));
  add('discard', v.discard.map(card => ({ card, place: { at: 'discard' } })));
  add('jail', v.jail.map(card => ({ card, place: { at: 'jail' } })));
  return out;
}

/**
 * What left and what arrived in one list. Cards keep their order when others are taken out
 * (hands and piles are spliced and pushed), so walking both lists together finds them.
 */
function compare(before: Entry[], after: Entry[]): { gone: Entry[]; came: Entry[] } {
  const gone: Entry[] = [];
  let j = 0;
  for (const e of before) {
    if (j < after.length && after[j]!.card === e.card) j++;
    else gone.push(e);
  }
  return { gone, came: after.slice(j) };
}

export interface DiffHints {
  /** The card being played this step: a hidden card leaving that player's hand is matched to it first. */
  played?: { seat: Seat; card: CardId };
  /** Where cards come from or go to when they appear from (or vanish into) nothing, e.g. a Quarantine. */
  fallback?: Place;
}

/** The cards that moved from `before` to `after`, as the viewer sees them. */
export function diffViews(before: GameState, after: GameState, hints: DiffHints = {}): Move[] {
  if (before.seats.length !== after.seats.length) return [];
  const a = entries(before), b = entries(after);
  const gone: Entry[] = [], came: Entry[] = [];
  for (const [key, list] of a) {
    const r = compare(list, b.get(key) ?? []);
    gone.push(...r.gone);
    came.push(...r.came);
  }
  // Pile reshuffles reorder the draw pile without moving anything: compare() sees those as moves
  // within the same pile, which are dropped below.
  const moves: Move[] = [];
  const take = (g: Entry, c: Entry) => {
    gone.splice(gone.indexOf(g), 1);
    came.splice(came.indexOf(c), 1);
    if (key(g.place) === key(c.place) && (g.place.at === 'draw' || g.place.at === 'discard' || g.place.at === 'jail')) return;
    moves.push({ card: g.card !== CARD_BACK ? g.card : c.card, from: g.place, to: c.place });
  };
  // 1. The same face on both sides
  for (const g of [...gone]) {
    if (g.card === CARD_BACK) continue;
    const c = came.find(x => x.card === g.card);
    if (c) take(g, c);
  }
  // 2. A hidden card becoming a face (or the other way round): the played card first, then in order
  const played = hints.played;
  if (played) {
    const g = gone.find(x => x.card === CARD_BACK && x.place.at === 'hand' && x.place.seat === played.seat);
    const c = came.find(x => x.card === played.card);
    if (g && c) take(g, c);
  }
  for (const g of [...gone]) {
    const c = came.find(x => g.card === CARD_BACK || x.card === CARD_BACK);
    if (c) take(g, c);
  }
  // 3. Leftovers vanish into, or appear from, the fallback place
  const nowhere = hints.fallback ?? { at: 'center' };
  for (const g of gone) moves.push({ card: g.card, from: g.place, to: nowhere });
  for (const c of came) moves.push({ card: c.card, from: nowhere, to: c.place });
  return moves;
}

export function key(p: Place): string {
  switch (p.at) {
    case 'hand': return 'hand' + p.seat;
    case 'walls': return 'walls' + p.seat;
    case 'guard': return 'guard';
    case 'limit': return 'limit' + p.seat;
    case 'seat': return 'seat' + p.seat;
    default: return p.at;
  }
}

/**
 * `before` with the moving cards taken out of where they were, but not yet put where they go:
 * what the board shows while the cards are in the air.
 */
export function midView(before: GameState, moves: readonly Move[]): GameState {
  const v = JSON.parse(JSON.stringify(before)) as GameState;
  const handSlots = new Map<Seat, number[]>();
  for (const m of moves) {
    const f = m.from;
    if (f.at === 'hand') handSlots.set(f.seat, [...(handSlots.get(f.seat) ?? []), f.slot]);
    else if (f.at === 'walls') removeOne(v.seats[f.seat]!.walls, f.kind);
    else if (f.at === 'limit') v.seats[f.seat]!.limitNext = 0;
    else if (f.at === 'guard') {
      const i = v.trainGuards.findIndex(g => g.seat === f.seat && g.kind === f.kind);
      if (i >= 0) v.trainGuards.splice(i, 1);
    } else if (f.at === 'draw') v.draw.pop();
    else if (f.at === 'discard') removeOne(v.discard, m.card, true);
    else if (f.at === 'jail') removeOne(v.jail, m.card, true);
  }
  for (const [seat, slots] of handSlots) {
    const hand = v.seats[seat]!.hand;
    for (const s of [...slots].sort((x, y) => y - x)) hand.splice(s, 1);
  }
  return v;
}

function removeOne(list: CardId[], card: CardId, fromTopIfMissing = false): void {
  const i = list.lastIndexOf(card);
  if (i >= 0) list.splice(i, 1);
  else if (fromTopIfMissing) list.pop();
}
