// Plays the game back one step at a time so people can follow it. The controller publishes a snapshot
// for every event; the animator queues them and shows each in turn: cards that moved fly from where they
// were to where they went (a played card stops in the middle first, face up, with what happened), and only
// then does the board show the new state. No DOM here: FlightLayer draws the flights it publishes.
import { CARD_BACK, type CardId, type GameState, type Seat } from '../../game';
import { shownHand } from '../board/board-state';
import type { GameSnapshot } from '../controller';
import { createStore, type Store } from '../store';
import { CENTER, placeRect, seatRect, type Rect, type Seating } from './layout';
import { diffViews, midView, type Move, type Place } from './moves';

/** One point of a card's path: at time `t` (ms from the start of the step) it is at this rect. */
export interface Key extends Rect { t: number; face: boolean }

export interface Flight { id: number; card: CardId; keys: Key[] }

export interface AnimState {
  /** What the board shows now (lags behind the game while cards are moving). */
  snap: GameSnapshot;
  flights: Flight[];
  /** How long the current flights take (ms). */
  duration: number;
  /** What's happening, shown while the cards move. */
  caption: string | null;
  /** The player a card is being played on, lit up while it's there. */
  target: Rect | null;
  /** Nothing waiting to be shown: the board is up to date and may be used. */
  idle: boolean;
}

// Timings at Normal speed (ms)
const T = { toCenter: 450, hold: 1000, toTarget: 450, move: 550, stagger: 90, maxStagger: 900 };
const MAX_FLIGHTS = 14;
/** With this many steps waiting (e.g. an online player catching up), play faster; with twice as many, skip. */
const BACKLOG = 8;

const REVEAL: readonly string[] = ['play', 'immediate'];
/** Happen every turn: no caption while their cards move. */
const ROUTINE: readonly string[] = ['deal', 'draw', 'turnStart', 'turnEnd', 'gameStart'];

export interface AnimatorOptions {
  /** Duration multiplier: 1 normal, >1 slower, 0 = no animation. Read at every step. */
  speed(): number;
}

export class Animator {
  readonly state: Store<AnimState>;
  private queue: GameSnapshot[] = [];
  private last: GameSnapshot;
  private running = false;
  private skipNow: (() => void) | null = null;
  private waiters: (() => void)[] = [];
  private nextId = 1;
  private readonly unsubscribe: () => void;

  constructor(private readonly source: Store<GameSnapshot>, private readonly opts: AnimatorOptions) {
    this.last = source.get();
    this.state = createStore<AnimState>({ snap: this.last, flights: [], duration: 0, caption: null, target: null, idle: true });
    this.unsubscribe = source.subscribe(s => this.push(s));
  }

  /** Resolves once everything that happened so far has been shown. */
  whenIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise(r => this.waiters.push(r));
  }

  /** Finish the current step now (tapping the board). */
  skip(): void { this.skipNow?.(); }

  dispose(): void { this.unsubscribe(); this.queue = []; this.skip(); }

  private push(s: GameSnapshot): void {
    if (same(s, this.last)) return;
    this.last = s;
    this.queue.push(s);
    this.set({ idle: false });
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length) await this.step(this.queue.shift()!);
    } finally {
      this.running = false;
      this.set({ idle: true });
      const w = this.waiters.splice(0);
      w.forEach(r => r());
    }
  }

  private set(p: Partial<AnimState>): void { this.state.set({ ...this.state.get(), ...p }); }

  private show(snap: GameSnapshot): void { this.set({ snap, flights: [], caption: null, target: null, duration: 0 }); }

  private async step(next: GameSnapshot): Promise<void> {
    const prev = this.state.get().snap;
    const backlog = this.queue.length;
    const speed = backlog >= BACKLOG * 2 ? 0 : this.opts.speed() * (backlog >= BACKLOG ? 0.4 : 1);
    const plan = speed > 0 ? planStep(prev, next, speed, () => this.nextId++) : null;
    if (!plan) { this.show(next); return; }
    this.set({ snap: { ...next, view: plan.mid, prompt: null, passTo: null }, flights: plan.flights, duration: plan.duration, caption: plan.caption, target: plan.target });
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.skipNow = null; resolve(); };
      const timer = setTimeout(done, plan.duration);
      this.skipNow = done;
    });
    this.show(next);
  }
}

export interface StepPlan { mid: GameState; flights: Flight[]; duration: number; caption: string | null; target: Rect | null }

/** How to show the step from `prev` to `next`, or null to just show `next` (nothing moved, or a new game / viewer). */
export function planStep(prev: GameSnapshot, next: GameSnapshot, speed: number, id: () => number = counter()): StepPlan | null {
  const before = prev.view, after = next.view;
  if (!before || !after || prev.viewer !== next.viewer || next.events.length < prev.events.length) return null;
  const fresh = next.events.slice(prev.events.length);
  const reveal = fresh.find(e => REVEAL.includes(e.type) && e.card !== undefined && e.seat !== undefined) ?? null;
  const main = reveal ?? fresh.find(e => e.seat !== undefined && !ROUTINE.includes(e.type)) ?? fresh.find(e => e.seat !== undefined) ?? null;
  const target = reveal?.target;
  const fallback: Place = target !== undefined ? { at: 'seat', seat: target }
    : main?.seat !== undefined ? { at: 'seat', seat: main.seat } : { at: 'center' };
  const moves = diffViews(before, after, { played: reveal ? { seat: reveal.seat!, card: reveal.card! } : undefined, fallback });
  if (!moves.length && !reveal) return null;

  const from: Seating = seating(prev), to: Seating = seating(next);
  const at = (p: Place, side: 'from' | 'to'): Rect => placeRect(p, side === 'from' ? before : after, side === 'from' ? from : to);
  const ms = (n: number) => n * speed;
  const flights: Flight[] = [];
  const flown: Move[] = [];
  let start = 0;
  let targetRect: Rect | null = null;

  if (reveal) {
    // The played card: from the hand to the middle, face up; to the player it's played on; then where it goes
    const card = reveal.card!;
    const fromHand = (m: Move) => m.from.at === 'hand' && m.from.seat === reveal.seat;
    let i = moves.findIndex(m => fromHand(m) && m.card === card);
    if (i < 0) i = moves.findIndex(m => fromHand(m) && m.card === CARD_BACK);
    const m: Move = i >= 0 ? { ...moves.splice(i, 1)[0]!, card } : {
      card, from: handPlace(before, reveal.seat!, card), to: fallback,
    };
    const t1 = ms(T.toCenter), t2 = t1 + ms(T.hold), t3 = t2 + (target !== undefined ? ms(T.toTarget) : 0), t4 = t3 + ms(T.move);
    const src = at(m.from, 'from');
    const keys: Key[] = [
      { t: 0, ...src, face: from.hand === reveal.seat },
      { t: t1, ...CENTER, face: true },
      { t: t2, ...CENTER, face: true },
    ];
    if (target !== undefined) {
      targetRect = rowRect(after, to, target);
      keys.push({ t: t3, ...grow(seatRect(after, to, target)), face: true });
    }
    keys.push({ t: t4, ...at(m.to, 'to'), face: true });
    flights.push({ id: id(), card, keys });
    flown.push(m);
    start = t3;
  }

  const shown = moves.slice(0, MAX_FLIGHTS);
  flown.push(...shown);
  const stagger = shown.length > 1 ? Math.min(ms(T.stagger), ms(T.maxStagger) / (shown.length - 1)) : 0;
  shown.forEach((m, n) => {
    const t0 = start + n * stagger, t1 = t0 + ms(T.move);
    const face = m.card !== CARD_BACK;
    const keys: Key[] = [{ t: 0, ...at(m.from, 'from'), face }];
    if (t0 > 0) keys.push({ t: t0, ...at(m.from, 'from'), face });
    keys.push({ t: t1, ...at(m.to, 'to'), face });
    flights.push({ id: id(), card: m.card, keys });
  });
  const duration = Math.max(...flights.map(f => f.keys.at(-1)!.t));
  return { mid: midView(before, flown), flights, duration, target: targetRect,
    caption: main && !ROUTINE.includes(main.type) ? main.text : null };
}

function seating(s: GameSnapshot): Seating {
  const v = s.view!;
  return { mine: v.seats[s.viewer]?.bot ? -1 : s.viewer, hand: shownHand(s) };
}

/** Where a played card was in its player's hand (slot 0 if the viewer can't see that hand). */
function handPlace(view: GameState, seat: Seat, card: CardId): Place {
  return { at: 'hand', seat, slot: Math.max(0, view.seats[seat]?.hand.indexOf(card) ?? 0) };
}

/** The whole area of a player, to light up. */
function rowRect(view: GameState, s: Seating, seat: Seat): Rect {
  if (seat === s.mine) return { x: 4, y: 168, w: 194, h: 42 };
  const r = seatRect(view, s, seat);
  return { x: 306, y: r.y - 2, w: 184, h: 25 };
}

/** A small spot made big enough to see a card on it. */
function grow(r: Rect): Rect {
  const w = Math.max(r.w, 34), h = Math.max(r.h, 47);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

function same(a: GameSnapshot, b: GameSnapshot): boolean {
  return a.viewer === b.viewer && a.prompt === b.prompt && a.passTo === b.passTo
    && a.events.length === b.events.length && JSON.stringify(a.view) === JSON.stringify(b.view);
}

function counter(): () => number { let n = 1; return () => n++; }
