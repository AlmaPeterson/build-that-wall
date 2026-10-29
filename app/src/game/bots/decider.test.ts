import { describe, expect, it } from 'vitest';
import { answer, createBotDecider } from './decider';
import { fixedMemory, makeState, type SeatSpec } from './test-api';
import type { Decision, GameState } from '../types';

type Of<K extends Decision['kind']> = Extract<Decision, { kind: K }>;

const mem = fixedMemory();
const ask = (s: GameState, d: Decision) => answer(d, s, mem);
const bot = (level: 'easy' | 'medium' | 'hard', extra: SeatSpec = {}): SeatSpec => ({ bot: level, ...extra });
const over = (n: number, fn: (seed: number) => unknown) => Array.from({ length: n }, (_, i) => fn(i + 1));

describe('blocking', () => {
  it('Medium and Hard always use Self-Defense and Savings', () => {
    for (const lvl of ['medium', 'hard'] as const) {
      const s = makeState([bot(lvl), {}]);
      expect(ask(s, { kind: 'block', seat: 0, attacker: 1, card: 17 })).toBe(true);
      expect(ask(s, { kind: 'paySavings', seat: 0, attacker: 1 })).toBe(true);
    }
  });

  it('Easy uses them about half the time', () => {
    for (const kind of ['block', 'paySavings'] as const) {
      const yes = over(200, rng => ask(makeState([bot('easy'), {}], { rng }),
        kind === 'block' ? { kind, seat: 0, attacker: 1, card: 9 } : { kind, seat: 0, attacker: 1 })).filter(Boolean).length;
      expect(yes).toBeGreaterThan(70);
      expect(yes).toBeLessThan(130);
    }
  });
});

describe('choosing a player (ai target)', () => {
  // seat 0 is the bot; seats 1-3 opponents
  const s = makeState([
    bot('hard'),
    { walls: [29], hand: [] },                    // 3 miles, no cards
    { walls: [30, 30], hand: [6, 26, 14] },       // 8 miles, 3 cards, 1 Trump
    { walls: [31, 31], hand: [25, 26] },          // 8 miles, 2 cards, 2 Trump cards
  ]);
  const seat = (card: number) => ask(s, { kind: 'chooseSeat', seat: 0, card, options: [1, 2, 3], cancellable: false });

  it('Democrat Border, Puppeteer, Quarantine: the leader, first seat on ties', () => {
    expect([9, 16, 17].map(seat)).toEqual([2, 2, 2]);
  });
  it('Controlled Opposition, Stimulus Check, Hand Swap: most cards', () => {
    expect([6, 21, 49].map(seat)).toEqual([2, 2, 2]);
  });
  it('Spy Balloon: most Trump cards', () => {
    expect(seat(5)).toBe(3);
  });
  it('Afghanistan Pull Out: fewest miles', () => {
    expect(seat(2)).toBe(1);
  });
  it('only picks from the options it was given', () => {
    expect(ask(s, { kind: 'chooseSeat', seat: 0, card: 9, options: [1], cancellable: false })).toBe(1);
    expect(ask(s, { kind: 'chooseSeat', seat: 0, card: 9, options: [], cancellable: true })).toBe(null);
  });
});

describe('choosing a wall', () => {
  it('Debt: the wall worth most to the bot by its own count', () => {
    const s = makeState([bot('medium', { walls: [30, 30] }), { walls: [29, 30] }]);
    const options = [{ seat: 1, kind: 29 }, { seat: 1, kind: 30 }];
    expect(ask(s, { kind: 'chooseWall', seat: 0, card: 7, options, cancellable: true })).toEqual({ seat: 1, kind: 30 });
  });

  it("Debt: Hard adds 4 for the leader's walls", () => {
    const s = makeState([bot('hard'), { walls: [29] }, { walls: [30, 31, 31] }]);
    const options = [{ seat: 1, kind: 29 }, { seat: 2, kind: 30 }];
    expect(ask(s, { kind: 'chooseWall', seat: 0, card: 7, options, cancellable: true })).toEqual({ seat: 2, kind: 30 });
  });

  it('Debt: Easy picks at random (owner decision)', () => {
    const options = [{ seat: 1, kind: 29 }, { seat: 1, kind: 30 }];
    const picks = over(100, rng => (ask(makeState([bot('easy'), { walls: [29, 30] }], { rng }),
      { kind: 'chooseWall', seat: 0, card: 7, options, cancellable: true }) as { kind: number }).kind);
    expect(new Set(picks)).toEqual(new Set([29, 30]));
  });

  it('Afghanistan Pull Out and Riot: give up the weakest wall', () => {
    const s = makeState([bot('hard', { walls: [29, 29, 30] }), {}]);
    const options = [{ seat: 0, kind: 29 }, { seat: 0, kind: 30 }];
    for (const card of [2, 15]) expect(ask(s, { kind: 'chooseWall', seat: 0, card, options, cancellable: false })).toEqual({ seat: 0, kind: 30 });
  });

  it('Trump Train pair and Spy Balloon guard: the first option', () => {
    const s = makeState([bot('hard'), {}]);
    const options = [{ seat: 1, kind: 33 }, { seat: 1, kind: 34 }];
    for (const card of [25, 5]) expect(ask(s, { kind: 'chooseWall', seat: 0, card, options, cancellable: false })).toEqual(options[0]);
  });
});

describe('choosing hand cards', () => {
  it('free builds: the wall worth most by own count, never stopping early', () => {
    const s = makeState([bot('hard', { hand: [29, 30, 14], walls: [30, 30] }), {}]);
    expect(ask(s, { kind: 'chooseHandCard', seat: 0, card: 3, purpose: 'build', options: [0, 1], optional: true })).toBe(1);
  });

  it('several free builds at once: as many as allowed, best first, counting the ones already picked', () => {
    const s = makeState([bot('hard', { hand: [29, 30, 31, 14], walls: [30, 30] }), {}]);
    const d = { kind: 'pickHandCards' as const, seat: 0, card: 13, purpose: 'build' as const, options: [0, 1, 2], cards: [29, 30, 31], min: 1, max: 2 };
    expect(ask(s, d)).toEqual([1, 0]);             // completes the 30 set first, then a new kind
    expect(ask(s, { ...d, max: 5 })).toEqual([1, 0, 2]);
  });

  it('handing out: give others the least valuable, keep the most valuable', () => {
    const s = makeState([bot('hard', { hand: [7, 29, 14, 12] }), {}]);
    const d: Of<'chooseHandCard'> = { kind: 'chooseHandCard', seat: 0, card: 8, purpose: 'give', options: [0, 1, 2, 3], optional: false };
    expect(ask(s, { ...d, to: 1 })).toBe(3);       // 12 is worth 1
    expect(ask(s, { ...d, to: 0 })).toBe(1);       // a wall is worth 5
  });

  it('respects the allowed slots and returns null with none', () => {
    const s = makeState([bot('hard', { hand: [7, 29, 14] }), {}]);
    expect(ask(s, { kind: 'chooseHandCard', seat: 0, card: 10, purpose: 'give', options: [1, 2], to: 1, optional: false })).toBe(2);
    expect(ask(s, { kind: 'chooseHandCard', seat: 0, card: 10, purpose: 'give', options: [], to: 1, optional: false })).toBe(null);
  });
});

describe('picking from piles', () => {
  it('takes the most valuable cards, first on ties', () => {
    const s = makeState([bot('hard'), {}]);
    expect(ask(s, { kind: 'pickCards', seat: 0, card: 22, pool: [12, 14, 30, 7, 29, 25], max: 3 })).toEqual([30, 29, 14]);
    expect(ask(s, { kind: 'pickCards', seat: 0, card: 27, pool: [12], max: 3 })).toEqual([12]);
  });
});

describe('options', () => {
  it('Trump Train: Medium and Hard protect; Easy half the time', () => {
    const d: Of<'chooseOption'> = { kind: 'chooseOption', seat: 0, card: 25, options: ['draw', 'protect'], cancellable: false };
    expect(ask(makeState([bot('hard'), {}]), d)).toBe('protect');
    expect(ask(makeState([bot('medium'), {}]), d)).toBe('protect');
    const picks = over(100, rng => ask(makeState([bot('easy'), {}], { rng }), d));
    expect(new Set(picks)).toEqual(new Set(['draw', 'protect']));
    expect(ask(makeState([bot('hard'), {}]), { ...d, options: ['draw'] })).toBe('draw');
  });

  it('Spy Balloon: remove a train when nobody has Trump cards, otherwise half the time', () => {
    const d: Of<'chooseOption'> = { kind: 'chooseOption', seat: 0, card: 5, options: ['take', 'remove'], cancellable: false };
    expect(ask(makeState([bot('hard'), { hand: [14] }]), d)).toBe('remove');
    const picks = over(100, rng => ask(makeState([bot('hard'), { hand: [26] }], { rng }), d));
    expect(new Set(picks)).toEqual(new Set(['take', 'remove']));
    expect(ask(makeState([bot('hard'), { hand: [26] }]), { ...d, options: ['take'] })).toBe('take');
  });

  it('Toilet Paper and others: the first real option, never stopping early', () => {
    const s = makeState([bot('hard'), {}]);
    expect(ask(s, { kind: 'chooseOption', seat: 0, card: 23, options: ['stop', '31', '35'], cancellable: true })).toBe('31');
  });
});

describe('the Decider interface', () => {
  it('answers through decide()', async () => {
    const s = makeState([bot('hard'), {}]);
    const decider = createBotDecider(0, mem);
    await expect(decider.decide({ kind: 'block', seat: 0, attacker: 1, card: 9 }, s)).resolves.toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = makeState([bot('easy'), {}], { rng: 99 }), b = structuredClone(a);
    const d = { kind: 'block', seat: 0, attacker: 1, card: 9 } as const;
    expect([ask(a, d), ask(a, d), ask(a, d)]).toEqual([ask(b, d), ask(b, d), ask(b, d)]);
  });
});
