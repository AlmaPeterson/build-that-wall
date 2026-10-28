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
