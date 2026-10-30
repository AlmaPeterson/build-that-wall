// Plays the game back one step at a time so people can follow it. The controller publishes a snapshot
// for every event; the animator queues them and shows each in turn: cards that moved fly from where they
// were to where they went (a card you play, or one played on you, stops in the middle first, face up, with
// what happened; other players' cards just fly across, big enough to tell which card it is), and only then
// does the board show the new state. No DOM here: FlightLayer draws the flights it publishes.
import { CARD_BACK, type CardId, type GameState, type Seat } from '../../game';
import { shownHand } from '../board/board-state';
import type { GameSnapshot } from '../controller';
import { createStore, type Store } from '../store';
import { CENTER, placeRect, seatRect, type Rect, type Seating } from './layout';
import { diffViews, midView, type Move, type Place } from './moves';

/** One point of a card's path: at time `t` (ms from the start of the step) it is at this rect. */
export interface Key extends Rect { t: number; face: boolean }

/** `big`: a played card that stops large in the middle, drawn from the high-quality picture. */
export interface Flight { id: number; card: CardId; keys: Key[]; big?: boolean }

/** Your own Play Immediately card, shown large until you tap Continue. */
export interface Confirm { card: CardId; text: string }

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
  /** A played card waiting halfway to its target, drawn where it stopped until the next step. */
  held: Held | null;
  /** Waiting for Continue on your own Play Immediately card. */
  confirm: Confirm | null;
  /** Stopped while a card is open full size. */
  paused: boolean;
  /** Nothing waiting to be shown: the board is up to date and may be used. */
  idle: boolean;
}

// Timings at Normal speed (ms)
const T = { toCenter: 450, hold: 1000, toTarget: 450, move: 550, stagger: 90, maxStagger: 900, blockIn: 550, blockHold: 800, deal: 380, dealGap: 110,
  across: 800, atTarget: 250 };
/** A card someone else plays, as it crosses the board: the size of the draw pile, so you can tell which it is. */
const PASSING = { w: 44, h: 61 };
const MAX_FLIGHTS = 14;
const DEAL_FLIGHTS = 36;   // 6 players × 5 cards + room
const SELF_DEFENSE = 20;
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
  private pauseNow: (() => void) | null = null;
  private resumeNow: (() => void) | null = null;
  private continueNow: (() => void) | null = null;
  private waiters: (() => void)[] = [];
  private nextId = 1;
  private readonly unsubscribe: () => void;

  constructor(private readonly source: Store<GameSnapshot>, private readonly opts: AnimatorOptions) {
    this.last = source.get();
    this.state = createStore<AnimState>({ snap: this.last, flights: [], duration: 0, caption: null, target: null, held: null, confirm: null, paused: false, idle: true });
    this.unsubscribe = source.subscribe(s => this.push(s));
  }

  /** Resolves once everything that happened so far has been shown. */
  whenIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise(r => this.waiters.push(r));
  }

  /** Finish the current step now (tapping the board). */
  skip(): void { this.skipNow?.(); }

  /** Stop where we are (a card was opened full size); `resume` carries on. */
  pause(): void {
    if (!this.pauseNow || this.state.get().paused) return;
    this.pauseNow();
    this.set({ paused: true });
  }

  resume(): void {
    if (!this.state.get().paused) return;
    this.set({ paused: false });
    this.resumeNow?.();
  }

  /** Continue after reading your own Play Immediately card. */
  continue(): void { this.continueNow?.(); }

  dispose(): void { this.unsubscribe(); this.queue = []; this.skip(); this.continue(); }

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

  private show(snap: GameSnapshot, held: Held | null = null): void {
    this.set({ snap, flights: [], caption: null, target: null, duration: 0, held, confirm: null, paused: false });
  }

  /** Wait `ms`, unless skipped; pausing stops the clock. */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      let left = ms, since = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        this.skipNow = this.pauseNow = this.resumeNow = null;
        resolve();
      };
      const go = () => { since = Date.now(); timer = setTimeout(done, left); };
      this.skipNow = done;
      this.pauseNow = () => { if (timer) { clearTimeout(timer); timer = null; left -= Date.now() - since; } };
      this.resumeNow = () => { if (!timer) go(); };
      go();
    });
  }

  private async step(next: GameSnapshot): Promise<void> {
    const prev = this.state.get().snap;
    const backlog = this.queue.length;
    const speed = backlog >= BACKLOG * 2 ? 0 : this.opts.speed() * (backlog >= BACKLOG ? 0.4 : 1);
    let held = this.state.get().held;
    if (speed <= 0 || !prev.view || prev.viewer !== next.viewer || next.events.length < prev.events.length) held = null;
    // Your own Play Immediately card always waits for Continue, even with animations off
    const own = ownImmediate(prev, next);
    const plan = speed > 0 || own ? planStep(prev, next, Math.max(speed, own ? 0.01 : 0), () => this.nextId++, held) : null;
    if (!plan) { this.show(next, held); return; }
    this.set({ snap: { ...next, view: plan.mid, prompt: null, passTo: null, turnBanner: null, skipped: null }, flights: plan.flights, duration: plan.duration,
      caption: plan.caption, target: plan.target, held: null });
    await this.wait(plan.duration);
    if (plan.confirm) {
      this.set({ confirm: plan.confirm.card });
      await new Promise<void>(r => { this.continueNow = () => { this.continueNow = null; r(); }; });
      this.set({ confirm: null, flights: plan.confirm.then.flights, duration: plan.confirm.then.duration, caption: null });
      await this.wait(plan.confirm.then.duration);
    }
    this.show(next, plan.held);
  }
}

/** A played card waiting halfway to the player it was played on, while they decide whether to block it. */
export interface Held { card: CardId; rect: Rect; target: Seat }

export interface StepPlan {
  mid: GameState; flights: Flight[]; duration: number; caption: string | null; target: Rect | null;
  /** The card left waiting at the end of this step, if any. */
  held: Held | null;
  /** Your own Play Immediately card: `flights` stop with it in the middle; after Continue, `then` plays. */
  confirm?: { card: Confirm; then: { flights: Flight[]; duration: number } };
}

/** The viewer drew a Play Immediately card on this step (and is a person, not a bot). */
function ownImmediate(prev: GameSnapshot, next: GameSnapshot): boolean {
  if (!next.view || prev.viewer !== next.viewer || next.events.length < prev.events.length) return false;
  const seat = next.view.seats[next.viewer];
  return !!seat && !seat.bot && next.events.slice(prev.events.length).some(e => e.type === 'immediate' && e.seat === next.viewer);
}

/** Where a blocked card and the Self-Defense meet when the card wasn't already waiting somewhere. */
const MEET: Rect = { x: 284, y: 110, w: 72, h: 100 };

/**
 * How to show the step from `prev` to `next`, or null to just show `next` (nothing moved, or a new game / viewer).
 * `held` is a played card left waiting by an earlier step.
 */
export function planStep(prev: GameSnapshot, next: GameSnapshot, speed: number, id: () => number = counter(),
  held: Held | null = null): StepPlan | null {
  const before = prev.view, after = next.view;
  if (!before || !after || prev.viewer !== next.viewer || next.events.length < prev.events.length) return null;
  const fresh = next.events.slice(prev.events.length);
  const reveal = fresh.find(e => REVEAL.includes(e.type) && e.card !== undefined && e.seat !== undefined) ?? null;
  const blocked = fresh.find(e => e.type === 'blocked' && e.card !== undefined && e.seat !== undefined) ?? null;
  const main = reveal ?? blocked ?? fresh.find(e => e.seat !== undefined && !ROUTINE.includes(e.type)) ?? fresh.find(e => e.seat !== undefined) ?? null;
  const dealing = fresh.some(e => e.type === 'deal');
  const confirming = reveal?.type === 'immediate' && ownImmediate(prev, next);
  const target = reveal?.target;
  const fallback: Place = target !== undefined ? { at: 'seat', seat: target }
    : main?.seat !== undefined ? { at: 'seat', seat: main.seat } : { at: 'center' };
  const moves = diffViews(before, after, { played: reveal ? { seat: reveal.seat!, card: reveal.card! } : undefined, fallback })
    // Cards coming off the draw pile are never shown, not even your own (they appear in your hand when they land)
    .map(m => (m.from.at === 'draw' ? { ...m, card: CARD_BACK } : m));
  if (!moves.length && !reveal && !blocked && !(held && fresh.length)) return null;
  if (dealing) moves.sort((a, b) => dealOrder(a) - dealOrder(b));    // one card to each player in turn

  const from: Seating = seating(prev), to: Seating = seating(next);
  const at = (p: Place, side: 'from' | 'to'): Rect => placeRect(p, side === 'from' ? before : after, side === 'from' ? from : to);
  const ms = (n: number) => n * speed;
  const flights: Flight[] = [];
  const flown: Move[] = [];
  const take = (pred: (m: Move) => boolean): Move | null => {
    const i = moves.findIndex(pred);
    return i < 0 ? null : moves.splice(i, 1)[0]!;
  };
  let start = 0;
  let targetRect: Rect | null = null;
  let heldAfter: Held | null = null;
  let splitAt = -1;
  const fromNowhere = (m: Move) => m.from.at === 'seat' || m.from.at === 'center';

  // A blocked card: the Self-Defense flies onto it (where it was waiting), then both go to the discard pile
  if (blocked) {
    const card = blocked.card!;
    const meet = held?.card === card ? held.rect : MEET;
    const own = take(m => m.card === card && fromNowhere(m));
    const sd = take(m => m.from.at === 'hand' && m.from.seat === blocked.seat && (m.card === SELF_DEFENSE || m.card === CARD_BACK));
    const t1 = ms(T.blockIn), t2 = t1 + ms(T.blockHold), t3 = t2 + ms(T.move);
    const discard = at({ at: 'discard' }, 'to');
    flights.push({ id: id(), card, keys: [{ t: 0, ...meet, face: true }, { t: t2, ...meet, face: true }, { t: t3, ...(own ? at(own.to, 'to') : discard), face: true }] });
    if (sd) {
      flown.push(sd);
      const onTop = { ...meet, x: meet.x + meet.w * 0.12, y: meet.y + meet.h * 0.08 };
      flights.push({ id: id(), card: SELF_DEFENSE, keys: [
        { t: 0, ...at(sd.from, 'from'), face: true }, { t: t1, ...onTop, face: true }, { t: t2, ...onTop, face: true },
        { t: t3, ...at(sd.to, 'to'), face: true },
      ] });
    }
    if (held?.card === card) held = null;
    start = t2;
  }

  // A card left waiting by the last step goes on to where it ended up (or into the player it was played on)
  if (held && fresh.length) {
    const h = held;
    const own = take(m => m.card === h.card && fromNowhere(m));
    const end = own ? at(own.to, 'to') : seatRect(after, to, h.target);
    flights.push({ id: id(), card: h.card, keys: [{ t: 0, ...h.rect, face: true }, { t: ms(T.move), ...end, face: true }] });
  }

  if (reveal) {
    // The played card: from the hand to the middle, face up; toward the player it's played on; then where it goes
    const card = reveal.card!;
    const fromHand = (m: Move) => m.from.at === 'hand' && m.from.seat === reveal.seat;
    // A hidden hand that lost the played card and got another one (a Spy Balloon taking your Trumps) looks
    // unchanged: then the card is the one that turned up from nowhere (on the discard pile), not a second copy
    const arrived = take(x => fromHand(x) && x.card === card) ?? take(x => fromHand(x) && x.card === CARD_BACK)
      ?? take(x => x.card === card && fromNowhere(x));
    const m: Move = arrived && fromHand(arrived) ? arrived
      : { card, from: handPlace(before, reveal.seat!, card), to: arrived?.to ?? fallback };
    m.card = card;
    // Not on any pile yet and played on nobody: it stays in the middle (it lands with a later step)
    if (m.to.at === 'seat' && target === undefined) m.to = { at: 'center' };
    // In a bot-only watch game, cards keep moving. In a game with people, your own cards go
    // straight to their destination while other players' cards pause in the middle to be read.
    const me = next.view && !next.view.seats[next.viewer]?.bot ? next.viewer : -1;
    const watchBots = !!next.openHands;
    // An unresolved play still needs to remain in the middle, and your Play Immediately card
    // must be readable before it continues. Every other card you play travels straight through.
    if (watchBots || (reveal.seat === me && !confirming && m.to.at !== 'center')) {
      const src = at(m.from, 'from');
      const keys: Key[] = [{ t: 0, ...src, face: true }];
      if (start > 0) keys.push({ ...keys[0]!, t: start });
      const passBy = (a: Rect, b: Rect) => sized(lerp(a, b, 0.5), PASSING);
      const t1 = start + ms(T.across);
      if (target !== undefined) {
        targetRect = rowRect(after, to, target);
        const spot = grow(seatRect(after, to, target));
        keys.push({ t: start + ms(T.across) / 2, ...passBy(src, spot), face: true }, { t: t1, ...spot, face: true });
        if (m.to.at === 'seat') heldAfter = { card, rect: spot, target };   // they may still block it: it waits there
        else keys.push({ t: t1 + ms(T.atTarget), ...spot, face: true }, { t: t1 + ms(T.atTarget) + ms(T.move), ...at(m.to, 'to'), face: true });
      } else {
        const end = m.to.at === 'center' ? sized(CENTER, PASSING) : at(m.to, 'to');   // waiting in the middle: not big
        keys.push({ t: start + ms(T.across) / 2, ...passBy(src, end), face: true }, { t: t1, ...end, face: true });
      }
      flights.push({ id: id(), card, keys });
      flown.push(m);
      // Effects (a draw, stealing a wall, etc.) happen after the played card has landed, not while
      // it is still being discarded. A held, blockable card has no effect yet.
      start = heldAfter ? t1 : keys.at(-1)!.t;
    } else {
      const t1 = start + ms(T.toCenter), t2 = t1 + (confirming ? 0 : ms(T.hold)), t3 = t2 + (target !== undefined ? ms(T.toTarget) : 0), t4 = t3 + ms(T.move);
      const keys: Key[] = [{ t: 0, ...at(m.from, 'from'), face: from.hand === reveal.seat }];
      if (start > 0) keys.push({ ...keys[0]!, t: start });   // waits in the hand until the block is over
      keys.push({ t: t1, ...CENTER, face: true }, { t: t2, ...CENTER, face: true });
      if (target !== undefined) {
        targetRect = rowRect(after, to, target);
        const spot = grow(seatRect(after, to, target));
        if (m.to.at === 'seat') {
          // Held nowhere yet: they may still block it, so it waits halfway
          const half = lerp(CENTER, spot, 0.5);
          keys.push({ t: t3, ...half, face: true });
          heldAfter = { card, rect: half, target };
        } else {
          keys.push({ t: t3, ...spot, face: true }, { t: t4, ...at(m.to, 'to'), face: true });
        }
      } else {
        keys.push({ t: t4, ...at(m.to, 'to'), face: true });
      }
      flights.push({ id: id(), card, keys, big: true });
      flown.push(m);
      // Don't start the card's effect until its discard flight has finished. A blockable card is
      // held at its target instead, so its resolution is necessarily a later snapshot.
      start = heldAfter ? t3 : t4;
      if (confirming) splitAt = t1;
    }
  }

  const cap = dealing ? DEAL_FLIGHTS : MAX_FLIGHTS;
  const shown = moves.slice(0, cap);
  flown.push(...shown);
  const each = dealing ? ms(T.deal) : ms(T.move);
  const stagger = dealing ? ms(T.dealGap)
    : shown.length > 1 ? Math.min(ms(T.stagger), ms(T.maxStagger) / (shown.length - 1)) : 0;
  shown.forEach((m, n) => {
    const t0 = start + n * stagger, t1 = t0 + each;
    const face = m.card !== CARD_BACK;
    const keys: Key[] = [{ t: 0, ...at(m.from, 'from'), face }];
    if (t0 > 0) keys.push({ t: t0, ...at(m.from, 'from'), face });
    keys.push({ t: t1, ...at(m.to, 'to'), face });
    flights.push({ id: id(), card: m.card, keys });
  });
  if (!flights.length) return null;
  const duration = Math.max(...flights.map(f => f.keys.at(-1)!.t));
  const plan: StepPlan = { mid: midView(before, flown), flights, duration, target: targetRect, held: heldAfter,
    caption: main && !ROUTINE.includes(main.type) ? main.text : null };
  if (splitAt < 0 || !reveal) return plan;
  // Stop with the card in the middle; everything after that plays once Continue is tapped
  const upToMiddle = flights.map(f => ({ ...f, keys: [...f.keys.filter(k => k.t <= splitAt)] }));
  const afterContinue = flights.map(f => {
    const at = [...f.keys].reverse().find(k => k.t <= splitAt)!;
    return { ...f, id: id(), keys: [{ ...at, t: 0 }, ...f.keys.filter(k => k.t > splitAt).map(k => ({ ...k, t: k.t - splitAt }))] };
  });
  return {
    ...plan, flights: upToMiddle, duration: splitAt, caption: null,
    confirm: { card: { card: reveal.card!, text: reveal.text }, then: { flights: afterContinue, duration: Math.max(0, duration - splitAt) } },
  };
}

/** Dealing: round by round, seat by seat. */
function dealOrder(m: Move): number {
  return m.to.at === 'hand' ? m.to.slot * 10 + m.to.seat : 1000;
}

function lerp(a: Rect, b: Rect, k: number): Rect {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
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

/** `r`'s centre, at size `s`. */
function sized(r: Rect, s: { w: number; h: number }): Rect {
  return { x: r.x + (r.w - s.w) / 2, y: r.y + (r.h - s.h) / 2, w: s.w, h: s.h };
}

/** A small spot made big enough to see a card on it. */
function grow(r: Rect): Rect {
  const w = Math.max(r.w, 34), h = Math.max(r.h, 47);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

function same(a: GameSnapshot, b: GameSnapshot): boolean {
  // Every field the board or overlays show: a change in any of them must get through (e.g. Quarantine's OK)
  return a.viewer === b.viewer && a.prompt === b.prompt && a.passTo === b.passTo && (a.turnBanner ?? null) === (b.turnBanner ?? null)
    && (a.skipped ?? null) === (b.skipped ?? null) && JSON.stringify(a.waitingFor ?? null) === JSON.stringify(b.waitingFor ?? null) && !!a.openHands === !!b.openHands && !!a.sharedDevice === !!b.sharedDevice
    && a.events.length === b.events.length && JSON.stringify(a.view) === JSON.stringify(b.view);
}

function counter(): () => number { let n = 1; return () => n++; }
