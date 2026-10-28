import { describe, expect, it } from 'vitest';
import { distribute, poolPick } from './shared';
import { makeContext, makeState } from './test-context';

const W1 = 29, W2 = 30, W3 = 31;

describe('distribute (handing out cards)', () => {
  it('goes clockwise from the next seat, the giver keeps their own share', async () => {
    // Giver is seat 1 of 4: order 2, 3, 0, 1(self), 2, ...
    const s = makeState([{}, { hand: [14, 19, 25, 26, 7, 20] }, {}, {}]);
    const ctx = makeContext(s, 1, 8);
    const tos: (number | undefined)[] = [];
    ctx.script.chooseHandCard = Array(6).fill((d: { to?: number }) => { tos.push(d.to); return 0; });
    expect(await distribute(ctx, 1, 'all')).toBe(5);
    expect(tos).toEqual([2, 3, 0, 1, 2, 3]);
    expect(s.seats[2]!.hand).toEqual([14, 7]);
    expect(s.seats[3]!.hand).toEqual([19, 20]);
    expect(s.seats[0]!.hand).toEqual([25]);
    expect(s.seats[1]!.hand).toEqual([26]);       // kept card comes back at the end
  });

  it('skips seats that left the game', async () => {
    const s = makeState([{ hand: [14, 19, 26] }, { left: true }, {}]);
    const ctx = makeContext(s, 0, 8);
    await distribute(ctx, 0, 'all');
    expect(s.seats[1]!.hand).toEqual([]);
    expect(s.seats[2]!.hand).toEqual([14, 26]);
    expect(s.seats[0]!.hand).toEqual([19]);
  });

  it('only hands out qualifying cards, offering only their slots', async () => {
    const s = makeState([{ hand: [14, W1, 7, W2] }, {}]);
    const ctx = makeContext(s, 0, 12);
    await distribute(ctx, 0, 'walls');
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseHandCard', purpose: 'give', options: [1, 3], to: 1 });
    expect(s.seats[1]!.hand).toEqual([W1]);
    expect(s.seats[0]!.hand).toEqual([14, 7, W2]);
  });

  it('traffic = Man Hour, Savings, Trump Train, Trump', async () => {
    const s = makeState([{ hand: [14, 19, 25, 26, 7, 20, W1] }, {}]);
    await distribute(makeContext(s, 0, 24), 0, 'traffic');
    expect([...s.seats[0]!.hand, ...s.seats[1]!.hand].sort()).toEqual([14, 19, 20, 25, 26, 29, 7].sort());
    expect(s.seats[1]!.hand).toEqual([14, 25]);
    expect(s.seats[0]!.hand).toEqual([7, 20, W1, 19, 26]);
  });

  it('with no self, everything goes to the others', async () => {
    const s = makeState([{ hand: [14, 19, 26] }, {}, {}]);
    await distribute(makeContext(s, 0, 46), 0, 'all', false);
    expect(s.seats[0]!.hand).toEqual([]);
    expect(s.seats[1]!.hand).toEqual([14, 26]);
    expect(s.seats[2]!.hand).toEqual([19]);
  });

  it('ignores a bad answer and gives the first qualifying card', async () => {
    const s = makeState([{ hand: [14, W1] }, {}]);
    const ctx = makeContext(s, 0, 12, { chooseHandCard: [0] });   // slot 0 is a Man Hour: not allowed for walls
    await distribute(ctx, 0, 'walls');
    expect(s.seats[1]!.hand).toEqual([W1]);
  });

  it('nothing to hand out: nothing asked', async () => {
    const s = makeState([{ hand: [14] }, {}]);
    const ctx = makeContext(s, 0, 12);
    expect(await distribute(ctx, 0, 'walls')).toBe(0);
    expect(ctx.asked).toEqual([]);
  });
});

describe('poolPick', () => {
  it('keeps only cards that are really in the pool, up to max, respecting counts', async () => {
    const s = makeState([{}, {}]);
    const ctx = makeContext(s, 0, 22, { pickCards: [[W1, W1, 99, W2, W3, W2]] });
    expect(await poolPick(ctx, [W1, W2, W3, W2], 3)).toEqual([W1, W2, W3]);
  });

  it('offers pack cards too', async () => {
    const s = makeState([{}, {}]);
    const ctx = makeContext(s, 0, 22, { pickCards: [[45, 49]] });
    expect(await poolPick(ctx, [45, 49, 14], 3)).toEqual([45, 49]);
    expect(ctx.asked[0]).toMatchObject({ kind: 'pickCards', pool: [45, 49, 14], max: 3 });
  });

  it('empty pool: nothing asked', async () => {
    const ctx = makeContext(makeState([{}, {}]), 0, 22);
    expect(await poolPick(ctx, [], 3)).toEqual([]);
    expect(ctx.asked).toEqual([]);
  });
});
