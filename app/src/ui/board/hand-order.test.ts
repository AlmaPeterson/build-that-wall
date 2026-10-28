import { beforeEach, describe, expect, it } from 'vitest';
import { displayIndex, displayOrder, moveCard, resetHandOrders } from './hand-order';

describe('hand order', () => {
  beforeEach(() => resetHandOrders());

  it('starts in the game order', () => {
    expect(displayOrder(0, [29, 14, 26])).toEqual([0, 1, 2]);
  });

  it('keeps an arrangement as cards come and go; new cards go on the end', () => {
    moveCard(0, [29, 14, 26], 2, 0);                         // Trump to the front
    expect(displayOrder(0, [29, 14, 26])).toEqual([2, 0, 1]);
    // the Man Hour was played (slot 1 gone), two cards drawn
    const hand = [29, 26, 30, 7];
    expect(displayOrder(0, hand).map(s => hand[s])).toEqual([26, 29, 30, 7]);
    expect(displayIndex(0, hand, 1)).toBe(0);
  });

  it('each player keeps their own arrangement', () => {
    moveCard(0, [29, 14], 1, 0);
    expect(displayOrder(1, [29, 14])).toEqual([0, 1]);
    expect(displayOrder(0, [29, 14])).toEqual([1, 0]);
  });
});
