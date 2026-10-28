// What the board shows and allows, worked out from a game snapshot. Pure functions, so they're easy to test.
// Rules: docs/game-rules.md sections 4-6. Layout follows the old game's Walls Display (Walls Display.txt).
import { cardById, isWall, type CardId } from '../../data/cards';
import { actionCost, milesFor, type GameApi, type GameState, type Seat } from '../../game';
import type { GameSnapshot } from '../controller';

export const MAN_HOUR = 14, SAVINGS = 19, SELF_DEFENSE = 20, TRUMP_TRAIN = 25;
/** Cards the Build Wall menu offers besides normal builds (Assassin, Legal Immigration, Voting Machine, Toilet Paper). */
export const BUILD_CARDS: readonly CardId[] = [3, 13, 28, 23];

/** True when the viewing player may act now: their turn, no question waiting, no pass screen, game running. */
export function canInteract(snap: GameSnapshot, busy = false): boolean {
  const v = snap.view;
  if (!v || busy || v.over || snap.prompt || snap.passTo !== null) return false;
  if (v.turn < 0 || v.turn !== snap.viewer) return false;
  return !v.seats[v.turn]?.bot;
}

/** Whose hand is on screen. null = hidden ("Hands are hidden while the computer plays"). */
export function shownHand(snap: GameSnapshot): Seat | null {
  const v = snap.view;
  if (!v) return null;
  const seat = v.seats[snap.viewer];
  if (!seat || seat.bot) return null;                      // watch mode: no human hand to show
  if (snap.prompt || snap.passTo !== null) return snap.viewer;
  if (v.turn >= 0 && v.seats[v.turn]?.bot && !v.over) return null;   // a bot is playing
  return snap.viewer;
}

/** How many of each wall kind a seat has built, in kind order (29-44), only kinds it has. */
export function wallKinds(state: GameState, seat: Seat): { kind: CardId; count: number }[] {
  const counts = new Map<CardId, number>();
  for (const k of state.seats[seat]?.walls ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0] - b[0]).map(([kind, count]) => ({ kind, count }));
}

export function miles(state: GameState, seat: Seat): number {
  return wallKinds(state, seat).reduce((n, w) => n + milesFor(w.count), 0);
}

export function sets(state: GameState, seat: Seat): number {
  return wallKinds(state, seat).filter(w => w.count >= 3).length;
}

export function isGuarded(state: GameState, seat: Seat, kind: CardId): boolean {
  return state.trainGuards.some(g => g.seat === seat && g.kind === kind);
}

/** Seats by miles, most first (ties keep seat order), with the old game's "1st:" labels (ties share a label). */
export function ranking(state: GameState): { seat: Seat; miles: number; label: string }[] {
  const LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const rows = state.seats.map((_, seat) => ({ seat, miles: miles(state, seat) }))
    .sort((a, b) => b.miles - a.miles || a.seat - b.seat);
  let label = '';
  return rows.map((r, i) => {
    if (i === 0 || r.miles !== rows[i - 1]!.miles) label = LABELS[i]!;
    return { ...r, label: label + ':' };
  });
}

/** What happens when a popup button is pressed. */
export type CardChoice =
  | { kind: 'build'; slot: number; manHour: number }        // build `slot` paying with the Man Hour in `manHour`
  | { kind: 'pickWalls'; slot: number }                     // then pick 2 other walls to discard
  | { kind: 'manHourOnWall'; manHour: number }              // then pick the wall to build
  | { kind: 'play'; slot: number };

export interface CardButton { label: string; choice: CardChoice }

export interface CardActions {
  buttons: CardButton[];
  /** Why nothing (or less) can be done with this card now; '' when nothing to explain. */
  note: string;
}

/** The buttons the card popup shows for the card in `slot` of the viewer's hand (Alerts and Buttons › Play Popup). */
export function cardActions(api: GameApi | null, snap: GameSnapshot, slot: number, busy = false): CardActions {
  const v = snap.view, seat = snap.viewer;
  const card = v?.seats[seat]?.hand[slot];
  if (!api || !v || card === undefined) return { buttons: [], note: '' };
  if (card === SAVINGS || card === SELF_DEFENSE) {
    return { buttons: [], note: card === SAVINGS ? 'Savings is only used to pay off a Debt played on you.' : 'Self-Defense is only used to block an attack on you.' };
  }
  if (!canInteract(snap, busy)) return { buttons: [], note: v.over ? 'The game is over.' : 'You can use this card on your turn.' };

  const builds = api.buildOptions(seat);
  if (isWall(card)) {
    const mine = builds.filter(b => b.slot === slot);
    const buttons: CardButton[] = [];
    if (mine.some(b => 'walls' in b.pay)) buttons.push({ label: 'Pick 2 Walls to Discard', choice: { kind: 'pickWalls', slot } });
    const mh = mine.find(b => 'manHour' in b.pay);
    if (mh && 'manHour' in mh.pay) buttons.push({ label: 'Discard a Man Hour', choice: { kind: 'build', slot, manHour: mh.pay.manHour } });
    const note = buttons.length ? '' : v.actionsLeft < 1 ? 'No actions left this turn.'
      : 'To build this you need a Man Hour or 2 other Wall Sections.';
    return { buttons, note };
  }
  if (card === MAN_HOUR) {
    if (builds.some(b => 'manHour' in b.pay)) return { buttons: [{ label: 'Use On Wall', choice: { kind: 'manHourOnWall', manHour: slot } }], note: '' };
    return { buttons: [], note: v.actionsLeft < 1 ? 'No actions left this turn.' : 'You need a Wall Section in your hand to use a Man Hour.' };
  }
  const ok = api.canPlay(seat, slot);
  if (!ok.ok) return { buttons: [], note: ok.reason };
  const cost = actionCost(card);
  return { buttons: [{ label: `Play (${cost} ${cost === 1 ? 'action' : 'actions'})`, choice: { kind: 'play', slot } }], note: '' };
}

/** One line of the Build Wall menu (Cards › define build options). */
export interface BuildOption { label: string; choice: CardChoice }

/** Every way to build now: per distinct wall kind in hand (max 8), with a Man Hour and/or by discarding 2 walls, then build cards. */
export function buildMenu(api: GameApi | null, snap: GameSnapshot, busy = false): BuildOption[] {
  const v = snap.view, seat = snap.viewer;
  if (!api || !v || !canInteract(snap, busy)) return [];
  const hand = v.seats[seat]!.hand;
  const builds = api.buildOptions(seat);
  const out: BuildOption[] = [];
  const kinds = new Set<CardId>(), done = new Set<string>();
  for (const b of builds) {
    const kind = hand[b.slot]!, how = 'manHour' in b.pay ? 'mh' : 'walls';
    if (done.has(kind + how) || (!kinds.has(kind) && kinds.size >= 8)) continue;   // one line per kind and payment, 8 kinds at most
    kinds.add(kind);
    done.add(kind + how);
    const name = cardById(kind).name;
    if ('manHour' in b.pay) out.push({ label: `${name} using your Man Hour`, choice: { kind: 'build', slot: b.slot, manHour: b.pay.manHour } });
    else out.push({ label: `${name} by discarding 2 other walls`, choice: { kind: 'pickWalls', slot: b.slot } });
  }
  const played = new Set<CardId>();
  hand.forEach((card, slot) => {
    if (BUILD_CARDS.includes(card) && !played.has(card) && api.canPlay(seat, slot).ok) {
      played.add(card);
      out.push({ label: `Play ${cardById(card).name}`, choice: { kind: 'play', slot } });
    }
  });
  return out;
}

/** Wall cards in the hand a Man Hour can build: every one of them, whichever Man Hour was picked. */
export function manHourWalls(hand: readonly CardId[]): number[] {
  return hand.flatMap((c, i) => (isWall(c) ? [i] : []));
}

/** Wall cards in the hand that can pay for building `slot` (any other wall). */
export function payableWalls(hand: readonly CardId[], slot: number): number[] {
  return hand.flatMap((c, i) => (i !== slot && isWall(c) ? [i] : []));
}

/** The name shown for a seat: bots get "BOT " in front (as the old scoreboard), plus "(left)". */
export function displayName(state: GameState, seat: Seat): string {
  const s = state.seats[seat]!;
  const name = s.bot ? 'BOT ' + s.name.replace(/^Bot /, '') : s.name;
  return name + (s.left ? ' (left)' : '');
}
