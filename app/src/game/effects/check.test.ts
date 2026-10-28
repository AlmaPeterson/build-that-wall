import { describe, expect, it } from 'vitest';
import { check } from './check';
import { makeState } from './test-context';

const W1 = 29, W2 = 30;
const reason = (r: ReturnType<typeof check>) => (r.ok ? 'ok' : r.reason);

describe('check (fx check)', () => {
  it('free builds need a Wall Section in hand', () => {
    for (const card of [3, 13, 28]) {
      expect(reason(check(makeState([{ hand: [card, 14] }, {}]), 0, card))).toBe('You need a Wall Section in your hand.');
      expect(check(makeState([{ hand: [card, W1] }, {}]), 0, card).ok).toBe(true);
    }
  });

  it('Toilet Paper needs 2 matching Wall Sections', () => {
    expect(reason(check(makeState([{ hand: [23, W1, W2] }, {}]), 0, 23))).toBe('You need 2 matching Wall Sections in your hand.');
    expect(check(makeState([{ hand: [23, W1, W2, W1] }, {}]), 0, 23).ok).toBe(true);
  });

  it('Spy Balloon: bots need an opponent with a Trump or a guarded train; humans can always play it', () => {
    expect(reason(check(makeState([{ hand: [5], bot: 'hard' }, { hand: [14] }]), 0, 5))).toBe('No opponent has a Trump card or a Trump Train.');
    expect(check(makeState([{ hand: [5] }, { hand: [14] }]), 0, 5).ok).toBe(true);
    expect(check(makeState([{ hand: [5], bot: 'hard' }, { hand: [26] }]), 0, 5).ok).toBe(true);
    expect(check(makeState([{ hand: [5], bot: 'hard' }, { hand: [25] }]), 0, 5).ok).toBe(true);
    expect(check(makeState([{ hand: [5], bot: 'hard' }, { walls: [W1, W1] }], { trainGuards: [{ seat: 1, kind: W1 }] }), 0, 5).ok).toBe(true);
    // Own guard doesn't count, nor a guard of a seat that left
    expect(check(makeState([{ hand: [5], bot: 'hard', walls: [W1, W1] }, {}], { trainGuards: [{ seat: 0, kind: W1 }] }), 0, 5).ok).toBe(false);
    expect(check(makeState([{ hand: [5], bot: 'easy' }, { hand: [26], left: true }]), 0, 5).ok).toBe(false);
  });

  it('Controlled Opposition and Stimulus Check need an opponent with cards', () => {
    for (const card of [6, 21]) {
      expect(reason(check(makeState([{ hand: [card] }, {}, {}]), 0, card))).toBe('No opponent has any cards in hand.');
      expect(check(makeState([{ hand: [card] }, {}, { hand: [14] }]), 0, card).ok).toBe(true);
    }
  });

  it('Debt needs an opponent wall that is not in a set of 3 and not guarded', () => {
    const msg = "No wall to take: Debt needs an opponent's built wall that is not part of a complete set of 3.";
    expect(reason(check(makeState([{ hand: [7] }, {}]), 0, 7))).toBe(msg);
    expect(reason(check(makeState([{ hand: [7] }, { walls: [W1, W1, W1] }]), 0, 7))).toBe(msg);
    expect(reason(check(makeState([{ hand: [7] }, { walls: [W1, W1] }], { trainGuards: [{ seat: 1, kind: W1 }] }), 0, 7))).toBe(msg);
    expect(reason(check(makeState([{ hand: [7], walls: [W2] }, {}]), 0, 7))).toBe(msg);
    expect(check(makeState([{ hand: [7] }, { walls: [W1, W1, W1, W2] }]), 0, 7).ok).toBe(true);
  });

  it('pile cards need cards in their piles', () => {
    expect(reason(check(makeState([{ hand: [22] }, {}], { discard: [14] }), 0, 22))).toBe('The draw pile is empty.');
    expect(reason(check(makeState([{ hand: [27] }, {}], { draw: [14] }), 0, 27))).toBe('The discard pile is empty.');
    expect(reason(check(makeState([{ hand: [45] }, {}], { draw: [14] }), 0, 45))).toBe('The discard pile is empty.');
    expect(reason(check(makeState([{ hand: [11] }, {}]), 0, 11))).toBe('The draw and discard piles are empty.');
    expect(check(makeState([{ hand: [11] }, {}], { discard: [14] }), 0, 11).ok).toBe(true);
    expect(check(makeState([{ hand: [22] }, {}], { draw: [14] }), 0, 22).ok).toBe(true);
  });

  it('Savings and Self-Defense are only used to block', () => {
    expect(reason(check(makeState([{ hand: [19] }, {}]), 0, 19))).toBe('This card is only used to block.');
    expect(reason(check(makeState([{ hand: [20] }, {}]), 0, 20))).toBe('This card is only used to block.');
  });

  it('Give It All Away needs another card and is never played by bots', () => {
    expect(reason(check(makeState([{ hand: [46] }, {}]), 0, 46))).toBe('You have no other cards to hand out.');
    expect(reason(check(makeState([{ hand: [46, 14], bot: 'hard' }, {}]), 0, 46))).toBe('You have no other cards to hand out.');
    expect(check(makeState([{ hand: [46, 14] }, {}]), 0, 46).ok).toBe(true);
  });

  it('walls, Man Hours and the card back are not played', () => {
    expect(check(makeState([{ hand: [W1] }, {}]), 0, W1).ok).toBe(false);
    expect(check(makeState([{ hand: [14] }, {}]), 0, 14).ok).toBe(false);
    expect(check(makeState([{ hand: [4] }, {}]), 0, 4).ok).toBe(false);
  });

  it('cards with no condition are always playable', () => {
    for (const card of [9, 16, 17, 25, 26, 47, 48, 49]) expect(check(makeState([{ hand: [card] }, {}]), 0, card).ok).toBe(true);
  });
});
