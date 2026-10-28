import { describe, expect, it } from 'vitest';
import { think } from './player';
import { fixedMemory, makeApi, makeState, type SeatSpec } from './test-api';
import type { Action, GameState } from '../types';

const mem = fixedMemory();
// Seat 0 is the bot under test; seat 1 is a human opponent with some cards and a wall
const table = (me: SeatSpec, opp: SeatSpec = { hand: [26, 14], walls: [35] }, opts: Partial<GameState> = {}) =>
  makeState([me, opp], opts);
const act = (s: GameState, unplayable: number[] = []) => think(makeApi(s, unplayable), 0, mem);

describe('Hard bots', () => {
  it('build the kind they already have a pair of, paying with a Man Hour', () => {
    expect(act(table({ bot: 'hard', hand: [29, 30, 14], walls: [30, 30] })))
      .toEqual({ type: 'build', slot: 1, pay: { manHour: 2 } });
  });

  it('pay with the first two other walls when they have no Man Hour', () => {
    expect(act(table({ bot: 'hard', hand: [29, 30, 31] }))).toEqual({ type: 'build', slot: 0, pay: { walls: [1, 2] } });
  });

  it('play Debt when they cannot build', () => {
    expect(act(table({ bot: 'hard', hand: [29, 7] }))).toEqual({ type: 'play', slot: 1 });
  });

  it('follow the priority list, and take the last copy of a card', () => {
    expect(act(table({ bot: 'hard', hand: [26, 6, 3, 29] }))).toEqual({ type: 'play', slot: 2 });
    expect(act(table({ bot: 'hard', hand: [25, 26, 25] }))).toEqual({ type: 'play', slot: 2 });
  });

  it('skip cards that fail the check or cost too much', () => {
    expect(act(table({ bot: 'hard', hand: [3, 6, 29] }), [3])).toEqual({ type: 'play', slot: 1 });
    expect(act(table({ bot: 'hard', hand: [6, 26] }, undefined, { actionsLeft: 0 }))).toEqual({ type: 'endTurn' });
  });

  it('protect a pair with a Trump Train when a human plays a lot of Debt', () => {
    const threat = fixedMemory({ 'Player 2': { debt: 0.5 } });
    const s = table({ bot: 'hard', hand: [25, 29, 14], walls: [30, 30] });
    expect(think(makeApi(s), 0, threat)).toEqual({ type: 'play', slot: 0 });
    // ...but still finish a set (gain 20)
    const s2 = table({ bot: 'hard', hand: [25, 30, 14], walls: [30, 30] });
    expect(think(makeApi(s2), 0, threat)).toEqual({ type: 'build', slot: 1, pay: { manHour: 2 } });
    // and without the threat they just build
    expect(act(table({ bot: 'hard', hand: [25, 29, 14], walls: [30, 30] }))).toEqual({ type: 'build', slot: 1, pay: { manHour: 2 } });
  });

  it("don't play Debt while protecting a pair", () => {
    const threat = fixedMemory({ 'Player 2': { debt: 0.5 } });
    const s = table({ bot: 'hard', hand: [7, 25], walls: [30, 30] });
    expect(think(makeApi(s), 0, threat)).toEqual({ type: 'play', slot: 1 });
  });

  it('stop when nothing is worth doing', () => {
    expect(act(table({ bot: 'hard', hand: [19, 20] }))).toEqual({ type: 'endTurn' });
    expect(act(table({ bot: 'hard', hand: [29, 30, 14] }, undefined, { actionsLeft: 0 }))).toEqual({ type: 'endTurn' });
  });

  it('never play Give It All Away (46)', () => {
    expect(act(table({ bot: 'hard', hand: [46] }))).toEqual({ type: 'endTurn' });
  });
});

describe('Medium bots', () => {
  it('play the first playable card in hand order', () => {
    expect(act(table({ bot: 'medium', hand: [26, 6, 3, 29] }))).toEqual({ type: 'play', slot: 0 });
  });

  it('play Debt before other cards', () => {
    expect(act(table({ bot: 'medium', hand: [6, 7, 29] }))).toEqual({ type: 'play', slot: 1 });
  });

  it('build when they can (gain is sometimes random, but always above 0)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const a = act(table({ bot: 'medium', hand: [29, 30, 14] }, undefined, { rng: seed }));
      expect(a.type).toBe('build');
    }
  });
});

describe('Easy bots', () => {
  const seeds = (fn: (seed: number) => Action) => Array.from({ length: 200 }, (_, i) => fn(i + 1));

  it('build when they can, skipping about 1 in 4 times, and never play a card instead', () => {
    const acts = seeds(rng => act(table({ bot: 'easy', hand: [29, 30, 14, 6] }, undefined, { rng })));
    expect(acts.every(a => a.type === 'build' || a.type === 'endTurn')).toBe(true);
    const builds = acts.filter(a => a.type === 'build').length;
    expect(builds).toBeGreaterThan(120);
    expect(builds).toBeLessThan(180);
  });

  it("play Debt or a card at random when they can't build (owner decision)", () => {
    const acts = seeds(rng => act(table({ bot: 'easy', hand: [29, 6, 7] }, undefined, { rng })));
    const slots = new Set(acts.map(a => (a.type === 'play' ? a.slot : -1)));
    expect(slots).toEqual(new Set([1, 2]));
  });

  it("don't count Debt when there is no wall to take", () => {
    const acts = seeds(rng => act(table({ bot: 'easy', hand: [29, 7] }, { hand: [26] }, { rng })));
    expect(acts.every(a => a.type === 'endTurn')).toBe(true);
  });

  it('stop when they can neither build nor play', () => {
    expect(act(table({ bot: 'easy', hand: [29, 19, 46] }))).toEqual({ type: 'endTurn' });
  });
});

describe('determinism', () => {
  it('the same seed gives the same choice and moves the generator the same way', () => {
    const a = table({ bot: 'easy', hand: [29, 30, 31, 14, 6] }, undefined, { rng: 777 });
    const b = structuredClone(a);
    expect(act(a)).toEqual(act(b));
    expect(a.rng).toBe(b.rng);
    expect(a.rng).not.toBe(777);
  });
});
