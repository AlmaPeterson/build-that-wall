import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, DEFAULT_SETTINGS, viewFor, type GameEvent, type GameState } from '../../game';
import type { GameSnapshot } from '../controller';
import { createStore } from '../store';
import { Animator, planStep } from './animator';
import { CENTER } from './layout';

function base(): GameState {
  const s = createGame({ ...DEFAULT_SETTINGS, players: 2, bots: 1 }, 1);
  s.draw = [14, 14, 14];
  s.discard = [];
  s.seats[0]!.hand = [29, 26];
  s.seats[1]!.hand = [7, 30];
  s.seats[0]!.walls = [33];
  s.turn = 1;
  return s;
}
const snap = (s: GameState, events: GameEvent[], viewer = 0): GameSnapshot => ({ view: viewFor(s, viewer), viewer, events, prompt: null, passTo: null });
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** The bot (seat 1) plays Debt on seat 0 and takes its wall. */
function debtStep() {
  const a = base();
  const b = clone(a);
  b.seats[1]!.hand = [30];
  b.discard = [7];
  b.seats[0]!.walls = [];
  b.seats[1]!.walls = [33];
  const play: GameEvent = { type: 'play', seat: 1, card: 7, target: 0, text: 'Bot played Debt on Player 1.' };
  return { prev: snap(a, []), next: snap(b, [play]) };
}

describe('planStep', () => {
  it("a bot's played card flies to the middle face up, to the player it's played on, then to the discard pile", () => {
    const { prev, next } = debtStep();
    const plan = planStep(prev, next, 1)!;
    expect(plan.caption).toBe('Bot played Debt on Player 1.');
    const [card, wall] = plan.flights;
    expect(card!.card).toBe(7);
    expect(card!.keys[0]!.face).toBe(false);                     // still hidden in the bot's hand
    expect(card!.keys[1]).toMatchObject({ ...CENTER, face: true });
    expect(card!.keys).toHaveLength(5);                          // hand, middle, (hold), the player, discard
    // The wall moves after the card has been seen
    expect(wall!.card).toBe(33);
    expect(wall!.keys[1]!.t).toBeGreaterThanOrEqual(card!.keys[3]!.t);
    expect(plan.duration).toBe(Math.max(card!.keys.at(-1)!.t, wall!.keys.at(-1)!.t));
    // While they fly, the board shows neither the card in the hand nor the wall anywhere
    expect(plan.mid.seats[1]!.hand).toHaveLength(1);
    expect(plan.mid.seats[0]!.walls).toEqual([]);
    expect(plan.mid.seats[1]!.walls).toEqual([]);
    expect(plan.mid.discard).toEqual([]);
  });

  it('slower speed takes longer; nothing moved or another viewer means no animation', () => {
    const { prev, next } = debtStep();
    expect(planStep(prev, next, 2)!.duration).toBe(planStep(prev, next, 1)!.duration * 2);
    expect(planStep(prev, { ...prev, events: [{ type: 'turnStart', seat: 0, text: '' }] }, 1)).toBeNull();
    expect(planStep(prev, { ...next, viewer: 1, view: viewFor(base(), 1) }, 1)).toBeNull();
  });
});

describe('Animator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows each step in turn and is idle once everything has been shown', async () => {
    const { prev, next } = debtStep();
    const source = createStore(prev);
    const anim = new Animator(source, { speed: () => 1 });
    let idle = false;
    source.set(next);
    void anim.whenIdle().then(() => { idle = true; });
    expect(anim.state.get().idle).toBe(false);
    expect(anim.state.get().flights.length).toBe(2);
    expect(anim.state.get().snap.view!.discard).toEqual([]);   // not landed yet
    await vi.advanceTimersByTimeAsync(anim.state.get().duration);
    expect(idle).toBe(true);
    expect(anim.state.get()).toMatchObject({ snap: next, flights: [], idle: true });
  });

  it('tapping skips the step; speed 0 shows it straight away', async () => {
    const { prev, next } = debtStep();
    const source = createStore(prev);
    const anim = new Animator(source, { speed: () => 1 });
    source.set(next);
    anim.skip();
    await vi.advanceTimersByTimeAsync(0);
    expect(anim.state.get().snap).toBe(next);

    const source2 = createStore(prev);
    const off = new Animator(source2, { speed: () => 0 });
    source2.set(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(off.state.get()).toMatchObject({ snap: next, idle: true });
  });

  it('a prompt waits until the cards before it have moved', async () => {
    const { prev, next } = debtStep();
    const source = createStore(prev);
    const anim = new Animator(source, { speed: () => 1 });
    source.set(next);
    const prompt = { decision: { kind: 'paySavings' as const, seat: 0, attacker: 1 }, answer: () => {} };
    source.set({ ...next, prompt });
    expect(anim.state.get().snap.prompt).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(anim.state.get().snap.prompt).toBe(prompt);
  });
});

describe('blocking', () => {
  /** The bot (seat 1) plays Controlled Opposition (6) on seat 0, who holds Self-Defense (20). */
  function attack() {
    const a = base();
    a.seats[0]!.hand = [29, 20];
    a.seats[1]!.hand = [6, 30];
    const b = clone(a);
    b.seats[1]!.hand = [30];                   // the card is in the air: in no pile yet
    const play: GameEvent = { type: 'play', seat: 1, card: 6, target: 0, text: 'Bot played Controlled Opposition on Player 1.' };
    return { a, b, play, prev: snap(a, []), next: snap(b, [play]) };
  }

  it('a card that can still be blocked waits halfway to its target', () => {
    const { prev, next } = attack();
    const plan = planStep(prev, next, 1)!;
    expect(plan.held).toMatchObject({ card: 6, target: 0 });
    const keys = plan.flights[0]!.keys;
    expect(keys.at(-1)).toMatchObject(plan.held!.rect);   // ends where it waits
    expect(plan.held!.rect.x).toBeLessThan(CENTER.x);       // on its way to seat 0's walls on the left
  });

  it('blocked: the Self-Defense flies onto the waiting card, then both go to the discard pile', () => {
    const { b, play, next } = attack();
    const held = planStep(snap(attack().a, []), next, 1)!.held!;
    const c = clone(b);
    c.seats[0]!.hand = [29];
    c.discard = [20, 6];
    const blocked: GameEvent = { type: 'blocked', seat: 0, target: 1, card: 6, text: 'Player 1 blocked Controlled Opposition with Self-Defense.' };
    const plan = planStep(next, snap(c, [play, blocked]), 1, undefined, held)!;
    expect(plan.caption).toBe(blocked.text);
    const card = plan.flights.find(f => f.card === 6)!, sd = plan.flights.find(f => f.card === 20)!;
    expect(card.keys[0]).toMatchObject(held.rect);                       // starts where it waited
    expect(sd.keys[1]!.x).toBeCloseTo(held.rect.x + held.rect.w * 0.12);  // lands on top of it
    expect(sd.keys[2]!.t).toBe(card.keys[1]!.t);                          // they leave together
    expect(card.keys.at(-1)!.x).toBe(sd.keys.at(-1)!.x);                  // for the discard pile
    expect(plan.held).toBeNull();
  });

  it('not blocked: the waiting card goes on to where it ended up', () => {
    const { b, play, next } = attack();
    const held = planStep(snap(attack().a, []), next, 1)!.held!;
    const c = clone(b);
    c.discard = [6];
    c.seats[0]!.hand = [20];
    c.seats[1]!.hand = [30, 29];
    const took: GameEvent = { type: 'cardMoved', seat: 1, target: 0, card: 6, text: 'Bot took 1 card(s) from Player 1.' };
    const plan = planStep(next, snap(c, [play, took]), 1, undefined, held)!;
    const card = plan.flights.find(f => f.card === 6)!;
    expect(card.keys[0]).toMatchObject(held.rect);
    expect(plan.flights).toHaveLength(2);                                 // the card, and the card taken
  });
});

describe('dealing and drawing', () => {
  it('deals one card to each player in turn, all face down, even your own', () => {
    const a = base();
    a.seats[0]!.hand = [];
    a.seats[1]!.hand = [];
    a.turn = -1;
    a.draw = [14, 29, 30, 31];
    const b = clone(a);
    b.seats[0]!.hand = [31, 29];
    b.seats[1]!.hand = [30, 14];
    b.draw = [];
    const deal: GameEvent = { type: 'deal', seat: 0, cards: [31, 29], text: '' };
    const plan = planStep(snap(a, []), snap(b, [deal]), 1)!;
    expect(plan.flights.map(f => f.card)).toEqual([4, 4, 4, 4]);
    const lands = plan.flights.map(f => f.keys.at(-1)!);
    expect(lands[0]!.x).not.toBe(lands[1]!.x);                            // seat 0, then seat 1, ...
    expect(lands[0]!.x).toBe(lands[2]!.x);
  });
});

describe('reading cards', () => {
  /** Seat 0 (a person) draws Abduction (1), a Play Immediately card, and it's played straight away. */
  function immediate() {
    const a = base();
    a.turn = 0;
    a.seats[0]!.hand = [29, 1];
    const b = clone(a);
    b.seats[0]!.hand = [29];
    b.discard = [1];
    const e: GameEvent = { type: 'immediate', seat: 0, card: 1, text: 'PLAY IMMEDIATELY: Player 1 drew Abduction.' };
    return { prev: snap(a, []), next: snap(b, [e]) };
  }

  it('your own Play Immediately card stops in the middle, sharp, until you tap Continue', async () => {
    vi.useFakeTimers();
    try {
      const { prev, next } = immediate();
      const plan = planStep(prev, next, 1)!;
      expect(plan.flights[0]!.big).toBe(true);
      expect(plan.flights[0]!.keys.at(-1)).toMatchObject(CENTER);           // stops in the middle
      expect(plan.confirm?.then.flights[0]!.keys[0]).toMatchObject(CENTER);  // and goes on from there
      const source = createStore(prev);
      const anim = new Animator(source, { speed: () => 0 });                 // even with animations off
      source.set(next);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(anim.state.get().confirm).toMatchObject({ card: 1 });
      expect(anim.state.get().idle).toBe(false);
      anim.continue();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(anim.state.get()).toMatchObject({ confirm: null, idle: true, snap: next });
    } finally { vi.useRealTimers(); }
  });

  it("a bot's Play Immediately card doesn't wait", () => {
    const { prev, next } = immediate();
    const bot = { ...next, view: { ...next.view!, seats: next.view!.seats.map((s, i) => (i === 0 ? { ...s, bot: 'easy' as const } : s)) } };
    expect(planStep(prev, bot, 1)!.confirm).toBeUndefined();
  });

  it('pausing (a card opened full size) stops the clock', async () => {
    vi.useFakeTimers();
    try {
      const { prev, next } = debtStep();
      const source = createStore(prev);
      const anim = new Animator(source, { speed: () => 1 });
      source.set(next);
      const total = anim.state.get().duration;
      await vi.advanceTimersByTimeAsync(100);
      anim.pause();
      await vi.advanceTimersByTimeAsync(total * 3);
      expect(anim.state.get()).toMatchObject({ paused: true, idle: false });
      anim.resume();
      await vi.advanceTimersByTimeAsync(total);
      expect(anim.state.get()).toMatchObject({ paused: false, idle: true, snap: next });
    } finally { vi.useRealTimers(); }
  });
});

describe('a played card with nowhere to go yet', () => {
  it("stays in the middle instead of flying to the player's own side", () => {
    const a = base();
    a.turn = 0;
    a.seats[0]!.hand = [27, 29];
    const b = clone(a);
    b.seats[0]!.hand = [29];                                     // in no pile yet
    const play: GameEvent = { type: 'play', seat: 0, card: 27, text: 'Player 1 played Vote Recount.' };
    const plan = planStep(snap(a, []), snap(b, [play]), 1)!;
    expect(plan.flights[0]!.keys.at(-1)).toMatchObject(CENTER);
  });
});
