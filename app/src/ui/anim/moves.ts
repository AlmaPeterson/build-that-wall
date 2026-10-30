// Board locations and the adapter for the engine's physical-card ledger. `diffViews` below remains
// only for restored/legacy snapshots that have no ledger moves; live games use exact transitions.
import { CARD_BACK, type CardId, type CardMove as CardMotion, type GameState, type Seat } from '../../game';

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
  /** Stable physical-card identity when this came from the engine ledger. */
  instance?: string;
  from: Place;
  to: Place;
}

/** Convert the engine's exact card transitions into board locations. Repositions are hand layout work, not flights. */
export function authoritativeMoves(motions: readonly CardMotion[]): Move[] {
  const moves: Move[] = [];
  const lastByInstance = new Map<string, Move>();
  for (const motion of motions) {
    if (motion.kind === 'reposition') continue;
    const from = fromLocation(motion.from, motion.card);
    const to = fromLocation(motion.to, motion.card);
    if (!from || !to) continue;
    const move: Move = { instance: motion.instance, card: motion.card, from, to };
    const previous = lastByInstance.get(motion.instance);
    // Online snapshots can arrive after several engine events. Keep that one physical card as
    // one route through the batch, rather than rendering the same instance in two flights.
    if (previous && samePlace(previous.to, from)) {
      previous.to = to;
    } else {
      moves.push(move);
      lastByInstance.set(motion.instance, move);
    }
  }
  return moves;
}

function samePlace(a: Place, b: Place): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function fromLocation(location: CardMotion['from'], card: CardId): Place | null {
  switch (location.zone) {
    case 'draw': return { at: 'draw' };
    case 'discard': return { at: 'discard' };
    case 'jail': return { at: 'jail' };
    case 'hand': return { at: 'hand', seat: location.seat, slot: location.index };
    case 'wall': return { at: 'walls', seat: location.seat, kind: card };
    case 'limit': return { at: 'limit', seat: location.seat };
    case 'trainGuard': return { at: 'guard', seat: location.seat, kind: location.wall };
    // A resolving or quarantined card is deliberately off the board, never invented from nowhere.
    case 'resolving': case 'quarantine': return { at: 'center' };
  }
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
  // 1. The card named by a play event gets first claim on its source and destination.  Doing this
  // before the general same-face pass matters when a deck has two copies of an action card: otherwise
  // another copy can be paired first, leaving the played card both in its hand and flying on screen.
  const played = hints.played;
  if (played) {
    const g = gone.find(x => x.place.at === 'hand' && x.place.seat === played.seat && (x.card === played.card || x.card === CARD_BACK));
    const c = came.find(x => x.card === played.card);
    if (g && c) take(g, c);
    else if (c) {
      // A hidden hand can lose the played card and gain a stolen card in the same snapshot, so its
      // card-back count is unchanged and there is no `gone` entry. Reserve the destination anyway;
      // otherwise another visible copy is incorrectly matched to it and both copies get animated.
      came.splice(came.indexOf(c), 1);
      moves.push({ card: played.card, from: { at: 'hand', seat: played.seat, slot: 0 }, to: c.place });
    }
  }
  // 2. The same face on both sides
  for (const g of [...gone]) {
    if (g.card === CARD_BACK) continue;
    const c = came.find(x => x.card === g.card);
    if (c) take(g, c);
  }
  // 3. A hidden card becoming a face (or the other way round), then in order
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
