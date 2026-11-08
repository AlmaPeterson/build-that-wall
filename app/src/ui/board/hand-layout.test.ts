import { describe, expect, it } from 'vitest';
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
        expect(s.y + s.h).toBeLessThanOrEqual(81);
      }
    }
  });

  it('a small hand is full size; a stack shows each card a little lower', () => {
    expect(handLayout([29, 14])[0]).toMatchObject({ w: 49, h: 67 });
    const [a, b] = handLayout([14, 14]);
    expect(b!.x).toBe(a!.x);
    expect(b!.y).toBeGreaterThan(a!.y + 3);
  });
});
