import { afterEach, describe, expect, it } from 'vitest';
import { layoutMode } from './geometry';
import { cards } from '../../data/cards';
import { colourRank, displayOrder, handLayout, stacks } from './hand-layout';

describe('hand layout', () => {
  it('sorts by colour: walls, Man Hour, purple, actions, pack cards, green, Self Defense, Play Immediately', () => {
    const hand = [1, 20, 19, 46, 3, 26, 14, 33, 29];
    expect(displayOrder(hand).map(k => hand[k])).toEqual([29, 33, 14, 26, 3, 46, 19, 20, 1]);
    expect(colourRank(25)).toBe(colourRank(26));                // Trump Train is purple too
    expect(colourRank(7)).toBe(colourRank(19));                 // Debt and Savings are green
    for (const c of cards) expect(colourRank(c.id)).toBeGreaterThanOrEqual(0);
  });

  it('stacks copies of a card, oldest at the bottom', () => {
    expect(stacks([14, 29, 14, 14])).toEqual([{ id: 29, slots: [1] }, { id: 14, slots: [0, 2, 3] }]);
  });

  it('keeps every card inside the hand box, however big the hand', () => {
    const many = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 3, 5, 6, 9, 11, 13, 16, 17, 14, 14, 14, 14, 14, 14];
    for (const hand of [[29], [29, 14, 26], [14, 14, 14, 14, 14, 14, 14, 14], many]) {
      const spots = handLayout(hand);
      expect(spots.filter(Boolean)).toHaveLength(hand.length);
      for (const s of spots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(461);
        expect(s.y + s.h).toBeLessThanOrEqual(95);
      }
    }
  });

  it('a small hand is full size; a stack shows each card a little lower', () => {
    expect(handLayout([29, 14])[0]).toMatchObject({ w: 60, h: 82 });
    const [a, b] = handLayout([14, 14]);
    expect(b!.x).toBe(a!.x);
    expect(b!.y).toBeGreaterThan(a!.y + 3);
  });
});

describe('hand layout on a phone held upright', () => {
  afterEach(() => layoutMode.set('wide'));

  it('a huge hand wraps onto more rows instead of squashing the cards together', () => {
    layoutMode.set('tall');
    // 35 cards: every Wall Section (16 kinds), several Man Hours, actions and more
    const hand = [...Array.from({ length: 16 }, (_, k) => 29 + k), 14, 14, 14, 14, 26, 25, 6, 9, 10, 16, 17, 18, 20, 21, 22, 23, 24, 27, 7];
    const spots = handLayout(hand);
    const rows = new Set(spots.map(s => Math.round(s.y))).size;
    expect(rows).toBeGreaterThan(1);
    // Side by side in a row, each card shows at least about half its width
    const tops = spots.filter((s, i) => spots.findIndex(t => t.x === s.x && Math.round(t.y) === Math.round(s.y)) === i);
    const byRow = new Map<number, number[]>();
    for (const s of tops) byRow.set(Math.round(s.y), [...(byRow.get(Math.round(s.y)) ?? []), s.x]);
    for (const xs of byRow.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(spots[0]!.w * 0.5);
    }
    for (const s of spots) { expect(s.x + s.w).toBeLessThanOrEqual(285 + 0.01); expect(s.y + s.h).toBeLessThanOrEqual(189 + 0.01); }
  });

  it('a normal hand still uses one row when it fits', () => {
    layoutMode.set('tall');
    expect(new Set(handLayout([29, 30, 14]).map(s => s.y)).size).toBe(1);
  });
});
