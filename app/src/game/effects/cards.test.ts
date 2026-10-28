import { describe, expect, it } from 'vitest';
import { cardRules } from './index';
import { counts, makeContext, makeState, type Script } from './test-context';
import type { GameState } from '../types';

const W1 = 29, W2 = 30, W3 = 31, W4 = 32;

/** Every card in the game, wherever it is: effects must never create or lose cards. */
const everything = (s: GameState) => counts([
  ...s.seats.flatMap(x => [...x.hand, ...x.walls, ...(x.limitNext ? [x.limitNext] : [])]),
  ...s.draw, ...s.discard, ...s.jail, ...s.trainGuards.map(() => 25),
]);

/** Play `card` for seat 0 the way the engine would: take it out of the hand, then run. */
async function play(s: GameState, card: number, script: Script = {}, player = 0) {
  const slot = s.seats[player]!.hand.indexOf(card);
  if (slot >= 0) s.seats[player]!.hand.splice(slot, 1);
  const ctx = makeContext(s, player, card, script);
  const ok = await cardRules.run(ctx);
  return { ctx, ok };
}

/** Run a Play Immediately card for seat 0 the way the engine would: already discarded. */
async function immediate(s: GameState, card: number, script: Script = {}, player = 0) {
  s.discard.push(card);
  const ctx = makeContext(s, player, card, script);
  await cardRules.runImmediate(ctx);
  return ctx;
}

describe('free builds: Assassin (3), Legal Immigration (13), Voting Machine (28)', () => {
  it('Assassin builds up to 2 for free', async () => {
    const s = makeState([{ hand: [3, W1, W2, W3] }, {}]);
    await play(s, 3);
    expect(s.seats[0]!.walls).toEqual([W1, W2]);
    expect(s.seats[0]!.hand).toEqual([W3]);
    expect(s.discard).toEqual([3]);
    expect(s.actionsLeft).toBe(3);
  });

  it('Legal Immigration builds up to 3; the first pick is required, later ones can stop', async () => {
    const s = makeState([{ hand: [13, W1, W2, W3, W4] }, {}]);
    const { ctx } = await play(s, 13, { chooseHandCard: [1, null] });
    expect(s.seats[0]!.walls).toEqual([W2]);
    expect(ctx.asked.map(d => d.kind === 'chooseHandCard' && d.optional)).toEqual([false, true]);
  });

  it('stops when no walls are left in hand', async () => {
    const s = makeState([{ hand: [28, W1] }, {}]);
    const { ctx } = await play(s, 28);
    expect(s.seats[0]!.walls).toEqual([W1]);
    expect(ctx.asked).toHaveLength(1);
  });
});

describe('Toilet Paper (23)', () => {
  it('builds every copy of the chosen kind; the first set is free, more sets cost 1 action each', async () => {
    const s = makeState([{ hand: [23, W1, W2, W1, W2, W2, 14] }, {}], { actionsLeft: 2 });
    await play(s, 23);
    expect(s.seats[0]!.walls.sort()).toEqual([W1, W1, W2, W2, W2]);
    expect(s.seats[0]!.hand).toEqual([14]);
    expect(s.actionsLeft).toBe(1);
  });

  it('can stop after the first set; the first choice cannot be cancelled', async () => {
    const s = makeState([{ hand: [23, W1, W1, W2, W2] }, {}]);
    const { ctx } = await play(s, 23, { chooseHandCard: [null, null] });
    expect(s.seats[0]!.walls).toEqual([W1, W1]);           // null on the first choice falls back to the first set
    expect(ctx.asked.map(d => d.kind === 'chooseHandCard' && d.optional)).toEqual([false, true]);
    expect(s.actionsLeft).toBe(3);
  });

  it('no further sets without actions', async () => {
    const s = makeState([{ hand: [23, W1, W1, W2, W2] }, {}], { actionsLeft: 0 });
    const { ctx } = await play(s, 23);
    expect(s.seats[0]!.walls).toEqual([W1, W1]);
    expect(ctx.asked).toHaveLength(1);
  });
});

describe('Chinese Spy Balloon (5)', () => {
  it('takes every Trump, then Trump Train, from the target', async () => {
    const s = makeState([{ hand: [5] }, { hand: [25, 14, 26, 26] }]);
    const before = everything(s);
    await play(s, 5);
    expect(s.seats[0]!.hand).toEqual([26, 26, 25]);
    expect(s.seats[1]!.hand).toEqual([14]);
    expect(everything(s)).toEqual(before);
  });

  it('only "take" is offered when no opponent pair is guarded', async () => {
    const s = makeState([{ hand: [5] }, { hand: [14] }]);
    const { ctx } = await play(s, 5);
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseOption', options: ['take'] });
    expect(ctx.events.at(-1)!.text).toContain('They had none.');
  });

  it('take can be blocked', async () => {
    const s = makeState([{ hand: [5] }, { hand: [26, 20] }]);
    await play(s, 5, { block: [true] });
    expect(s.seats[1]!.hand).toEqual([26]);
    expect(s.discard).toEqual([20, 5]);   // the blocked card is discarded after the Self-Defense
  });

  it('removes a Trump Train from a guarded opponent pair', async () => {
    const s = makeState([{ hand: [5] }, { walls: [W1, W1] }], { trainGuards: [{ seat: 1, kind: W1 }] });
    await play(s, 5, { chooseOption: ['remove'] });
    expect(s.trainGuards).toEqual([]);
    expect(s.discard).toEqual([5, 25]);
  });

  it('removing can be blocked', async () => {
    const s = makeState([{ hand: [5] }, { walls: [W1, W1], hand: [20] }], { trainGuards: [{ seat: 1, kind: W1 }] });
    await play(s, 5, { chooseOption: ['remove'], block: [true] });
    expect(s.trainGuards).toHaveLength(1);
  });
});

describe('Controlled Opposition (6) and Stimulus Check (21)', () => {
  it('Controlled Opposition takes 2 random cards; only opponents with cards are offered', async () => {
    const s = makeState([{ hand: [6] }, {}, { hand: [14, 19, 7] }]);
    const { ctx } = await play(s, 6);
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseSeat', options: [2] });
    expect(s.seats[0]!.hand).toHaveLength(2);
    expect(s.seats[2]!.hand).toHaveLength(1);
  });

  it('Controlled Opposition can be blocked', async () => {
    const s = makeState([{ hand: [6] }, { hand: [14, 20] }]);
    await play(s, 6, { block: [true] });
    expect(s.seats[0]!.hand).toEqual([]);
    expect(s.seats[1]!.hand).toEqual([14]);
  });

  it('Stimulus Check takes 3 random cards and is not blockable', async () => {
    const s = makeState([{ hand: [21] }, { hand: [20, 14, 7, 19] }]);
    const { ctx } = await play(s, 21);
    expect(ctx.asked.some(d => d.kind === 'block')).toBe(false);
    expect(s.seats[0]!.hand).toHaveLength(3);
  });

  it('takes what is there when the target has fewer cards', async () => {
    const s = makeState([{ hand: [21] }, { hand: [14] }]);
    await play(s, 21);
    expect(s.seats[0]!.hand).toEqual([14]);
  });
});

describe('Democrat Border (9), Puppeteer (16), Quarantine (17)', () => {
  it('Democrat Border: the target gets 1 action next turn and the card is held', async () => {
    const s = makeState([{ hand: [9] }, {}]);
    await play(s, 9);
    expect(s.seats[1]!.limitNext).toBe(9);
    expect(s.discard).toEqual([]);
  });

  it('a new limit replaces the old one, which is discarded', async () => {
    const s = makeState([{ hand: [16] }, {}]);
    s.seats[1]!.limitNext = 9;
    await play(s, 16);
    expect(s.seats[1]!.limitNext).toBe(16);
    expect(s.discard).toEqual([9]);
  });

  it('blocked: the card is discarded', async () => {
    const s = makeState([{ hand: [9] }, { hand: [20] }]);
    await play(s, 9, { block: [true] });
    expect(s.seats[1]!.limitNext).toBe(0);
    expect(s.discard.sort()).toEqual([20, 9].sort());
  });

  it('Quarantine: the target skips their next turn; it is only blockable when played', async () => {
    const s = makeState([{ hand: [17] }, { hand: [20] }, {}]);
    const { ctx } = await play(s, 17, { chooseSeat: [1] });
    expect(ctx.asked.filter(d => d.kind === 'block')).toHaveLength(1);
    expect(s.seats[1]!.skipNext).toBe(true);
    expect(s.seats[1]!.skipBy).toBe(0);
    expect(s.discard).toEqual([]);
  });

  it('Quarantine on someone already quarantined is just discarded', async () => {
    const s = makeState([{ hand: [17] }, {}]);
    s.seats[1]!.skipNext = true; s.seats[1]!.skipBy = 1;
    await play(s, 17);
    expect(s.seats[1]!.skipBy).toBe(1);
    expect(s.discard).toEqual([17]);
  });

  it('seats that left are not offered', async () => {
    const s = makeState([{ hand: [9] }, { left: true }, {}]);
    const { ctx } = await play(s, 9);
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseSeat', options: [2] });
  });
});

describe('Debt (7)', () => {
  it('takes one section of the chosen wall', async () => {
    const s = makeState([{ hand: [7] }, { walls: [W1, W1, W2] }]);
    const { ok } = await play(s, 7, { chooseWall: [{ seat: 1, kind: W1 }] });
    expect(ok).toBe(true);
    expect(s.seats[0]!.walls).toEqual([W1]);
    expect(s.seats[1]!.walls).toEqual([W1, W2]);
    expect(s.discard).toEqual([7]);
  });

  it('only walls not in a set of 3 and not guarded are offered', async () => {
    const s = makeState([{ hand: [7] }, { walls: [W1, W1, W1, W2, W2, W3] }, { walls: [W4] }],
      { trainGuards: [{ seat: 1, kind: W2 }] });
    const { ctx } = await play(s, 7);
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseWall', options: [{ seat: 1, kind: W3 }, { seat: 2, kind: W4 }], cancellable: true });
  });

  it('backing out costs nothing', async () => {
    const s = makeState([{ hand: [7] }, { walls: [W1] }]);
    const { ok } = await play(s, 7, { chooseWall: [null] });
    expect(ok).toBe(false);
    expect(s.discard).toEqual([]);
    expect(s.seats[1]!.walls).toEqual([W1]);
  });

  it('the owner may pay with Savings', async () => {
    const s = makeState([{ hand: [7] }, { walls: [W1], hand: [19, 14] }]);
    const { ctx } = await play(s, 7, { paySavings: [true] });
    expect(s.seats[1]!.walls).toEqual([W1]);
    expect(s.seats[1]!.hand).toEqual([14]);
    expect(s.discard).toEqual([7, 19]);
    expect(ctx.asked.some(d => d.kind === 'block')).toBe(false);   // Self-Defense doesn't stop Debt
  });

  it('declining Savings loses the wall; no Savings: not asked', async () => {
    const s = makeState([{ hand: [7] }, { walls: [W1], hand: [19] }]);
    await play(s, 7, { paySavings: [false] });
    expect(s.seats[0]!.walls).toEqual([W1]);
    const s2 = makeState([{ hand: [7] }, { walls: [W1] }]);
    const { ctx } = await play(s2, 7);
    expect(ctx.asked.some(d => d.kind === 'paySavings')).toBe(false);
  });

  it('taking a wall that completes a guarded set releases the guard', async () => {
    const s = makeState([{ hand: [7], walls: [W1, W1] }, { walls: [W1] }], { trainGuards: [{ seat: 0, kind: W1 }] });
    await play(s, 7);
    expect(s.seats[0]!.walls).toEqual([W1, W1, W1]);
    expect(s.trainGuards).toEqual([]);
    expect(s.discard).toEqual([7, 25]);
  });
});

describe('Trump (26) and Trump Train (25)', () => {
  it('Trump: discard and draw 3', async () => {
    const s = makeState([{ hand: [26] }, {}], { draw: [14, 7, 19, 20] });
    await play(s, 26);
    expect(s.seats[0]!.hand).toEqual([20, 19, 7]);
    expect(s.discard).toEqual([26]);
  });

  it('Trump draws through a reshuffle of the discard pile (which includes the Trump)', async () => {
    const s = makeState([{ hand: [26] }, {}], { draw: [14], discard: [7] });
    await play(s, 26);
    expect(s.seats[0]!.hand.sort()).toEqual([14, 26, 7].sort());
    expect(s.discard).toEqual([]);
  });

  it('Trump Train with no pair: only draw is offered', async () => {
    const s = makeState([{ hand: [25] }, {}], { draw: [14, 14, 14] });
    const { ctx } = await play(s, 25);
    expect(ctx.asked[0]).toMatchObject({ kind: 'chooseOption', options: ['draw'], cancellable: true });
    expect(s.seats[0]!.hand).toEqual([14, 14, 14]);
    expect(s.discard).toEqual([25]);
  });

  it('Trump Train protects a built pair and is held', async () => {
    const s = makeState([{ hand: [25], walls: [W1, W1, W2, W3, W3, W3] }, {}]);
    const { ctx } = await play(s, 25, { chooseOption: ['protect'] });
    expect(ctx.asked[1]).toMatchObject({ kind: 'chooseWall', options: [{ seat: 0, kind: W1 }] });
    expect(s.trainGuards).toEqual([{ seat: 0, kind: W1 }]);
    expect(s.discard).toEqual([]);
  });

  it('backing out of Trump Train costs nothing', async () => {
    const s = makeState([{ hand: [25], walls: [W1, W1] }, {}]);
    expect((await play(s, 25, { chooseOption: [null] })).ok).toBe(false);
    expect((await play(s, 25, { chooseOption: ['protect'], chooseWall: [null] })).ok).toBe(false);
    expect(s.trainGuards).toEqual([]);
    expect(s.discard).toEqual([]);
  });
});

describe('pile picks: Freedom of the Press (11), Supreme Court Nominee (22), Vote Recount (27)', () => {
  it('Supreme Court Nominee: up to 3 from the draw pile into the hand', async () => {
    const s = makeState([{ hand: [22] }, {}], { draw: [14, 7, W1, 19], discard: [20] });
    const { ctx } = await play(s, 22, { pickCards: [[W1, 19]] });
    expect(ctx.asked[0]).toMatchObject({ kind: 'pickCards', pool: [14, 7, W1, 19], max: 3 });
    expect(s.seats[0]!.hand).toEqual([W1, 19]);
    expect(counts(s.draw)).toEqual(counts([14, 7]));
    expect(s.discard).toEqual([20, 22]);
  });

  it('Vote Recount: up to 3 from the discard pile, then the card is discarded', async () => {
    const s = makeState([{ hand: [27] }, {}], { draw: [14], discard: [7, W1, 7] });
    const { ctx } = await play(s, 27, { pickCards: [[7, 7]] });
    expect(ctx.asked[0]).toMatchObject({ pool: [7, W1, 7], max: 3 });
    expect(s.seats[0]!.hand).toEqual([7, 7]);
    expect(s.discard).toEqual([W1, 27]);
    expect(s.draw).toEqual([14]);
    expect(ctx.discardAtEmit[0]).toContain(27);    // already on the pile when it's announced (so it's seen going there)
  });

  it('Freedom of the Press: up to 4 from both piles into jail, with the card; release in 3 rounds; draw shuffled', async () => {
    const s = makeState([{ hand: [11] }, {}, {}], { draw: [14, W1], discard: [W1, 7], turnCount: 5 });
    const before = everything(s);
    const { ctx } = await play(s, 11, { pickCards: [[W1, W1, 14]] });
    expect(ctx.asked[0]).toMatchObject({ pool: [14, W1, W1, 7], max: 4 });
    expect(s.jail).toEqual([W1, W1, 14, 11]);
    expect(s.discard).toEqual([7]);     // the first W1 came from the discard pile, the second from the draw pile
    expect(s.draw).toEqual([]);
    expect(s.jailRelease).toBe(5 + 3 * 3);
    expect(everything(s)).toEqual(before);
  });
});

describe('Play Immediately cards', () => {
  it('Abduction discards a Man Hour unless blocked; no Man Hour: no effect', async () => {
    const s = makeState([{ hand: [7, 14, 14] }, {}]);
    await immediate(s, 1);
    expect(s.seats[0]!.hand).toEqual([7, 14]);
    expect(s.discard).toEqual([1, 14]);
    const b = makeState([{ hand: [14, 20] }, {}]);
    await immediate(b, 1, { block: [true] });
    expect(b.seats[0]!.hand).toEqual([14]);
    const n = makeState([{ hand: [20] }, {}]);
    const ctx = await immediate(n, 1);
    expect(ctx.asked).toEqual([]);
    expect(n.seats[0]!.hand).toEqual([20]);
  });

  it("Afghanistan Pull Out: one of your walls goes onto an opponent's board, still built", async () => {
    const s = makeState([{ walls: [W1, W2, W2, W2] }, {}, {}]);
    const ctx = await immediate(s, 2, { chooseSeat: [2] });
    expect(ctx.asked.find(d => d.kind === 'chooseWall')).toMatchObject({ options: [{ seat: 0, kind: W1 }], cancellable: false });
    expect(s.seats[0]!.walls).toEqual([W2, W2, W2]);
    expect(s.seats[2]!.walls).toEqual([W1]);
    expect(s.seats[2]!.hand).toEqual([]);
  });

  it('Afghanistan Pull Out: sets of 3 and guarded pairs are safe; blockable', async () => {
    const s = makeState([{ walls: [W1, W1, W1, W2, W2], hand: [20] }, {}], { trainGuards: [{ seat: 0, kind: W2 }] });
    const ctx = await immediate(s, 2);
    expect(ctx.asked).toEqual([]);
    const b = makeState([{ walls: [W1], hand: [20] }, {}]);
    await immediate(b, 2, { block: [true] });
    expect(b.seats[0]!.walls).toEqual([W1]);
  });

  it('Deep State hands out the whole hand; Trafficking only Savings, Trump, Trump Train, Man Hour', async () => {
    const s = makeState([{ hand: [14, 7, W1] }, {}]);
    await immediate(s, 8);
    expect(s.seats[1]!.hand).toEqual([14, W1]);
    expect(s.seats[0]!.hand).toEqual([7]);
    const t = makeState([{ hand: [7, 14, 19, 26] }, {}]);
    await immediate(t, 24);
    expect(t.seats[1]!.hand).toEqual([14, 26]);
    expect(t.seats[0]!.hand).toEqual([7, 19]);
  });

  it('Deep State can be blocked', async () => {
    const s = makeState([{ hand: [14, 20] }, {}]);
    await immediate(s, 8, { block: [true] });
    expect(s.seats[0]!.hand).toEqual([14]);
    expect(s.seats[1]!.hand).toEqual([]);
  });

  it('Lawfare hands out the walls and is not blockable', async () => {
    const s = makeState([{ hand: [20, W1, W2, W3] }, {}, {}]);
    const ctx = await immediate(s, 12);
    expect(ctx.asked.some(d => d.kind === 'block')).toBe(false);
    expect(s.seats[1]!.hand).toEqual([W1]);
    expect(s.seats[2]!.hand).toEqual([W2]);
    expect(s.seats[0]!.hand).toEqual([20, W3]);
  });

  it('Fake News: everyone above the lowest gives a wall/Trump to the lowest players in rotation', async () => {
    // Miles: seat0 = 3, seat1 = 0, seat2 = 3, seat3 = 0 → lowest are 1 and 3
    const s = makeState([{ walls: [W1], hand: [W2, 14] }, { hand: [W3] }, { walls: [W1], hand: [26] }, {}], );
    const ctx = await immediate(s, 10);
    expect(ctx.asked.map(d => d.kind === 'chooseHandCard' && [d.seat, d.to, d.options])).toEqual([[0, 1, [0]], [2, 3, [0]]]);
    expect(s.seats[1]!.hand).toEqual([W3, W2]);
    expect(s.seats[3]!.hand).toEqual([26]);
  });

  it('Fake News: no effect if everyone ties; players with nothing to give are skipped', async () => {
    const s = makeState([{ walls: [W1], hand: [W2] }, { walls: [W2], hand: [W3] }]);
    const ctx = await immediate(s, 10);
    expect(ctx.asked).toEqual([]);
    expect(ctx.events.at(-1)!.text).toContain('same miles');
    const t = makeState([{ walls: [W1], hand: [14] }, { walls: [W2, W2], hand: [W3] }, {}]);
    const c2 = await immediate(t, 10);
    expect(c2.asked).toHaveLength(1);                        // seat 0 has nothing to give
    expect(t.seats[2]!.hand).toEqual([W3]);
  });

  it('Mostly Peaceful Riot: everyone with an eligible wall pulls one back into their hand, unless they block', async () => {
    const s = makeState([{ walls: [W1, W2, W2, W2] }, { walls: [W3], hand: [20] }, { walls: [W4, W4] }, {}]);
    const ctx = await immediate(s, 15, { block: [true] });
    expect(ctx.asked.filter(d => d.kind === 'chooseWall').map(d => d.seat)).toEqual([0, 2]);
    expect(s.seats[0]!.walls).toEqual([W2, W2, W2]);
    expect(s.seats[0]!.hand).toEqual([W1]);
    expect(s.seats[1]!.walls).toEqual([W3]);
    expect(s.seats[2]!.walls).toEqual([W4]);
    expect(s.seats[2]!.hand).toEqual([W4]);
  });

  it('Redistribution: everyone tied for most cards hands out their whole hand, in seat order', async () => {
    const s = makeState([{ hand: [14] }, { hand: [7, 19] }, { hand: [W1, W2] }]);
    const before = everything(s);
    s.discard.push(18);
    const ctx = makeContext(s, 0, 18);
    await cardRules.runImmediate(ctx);
    // seat 1 hands out first (to 2, then keeps one), then seat 2 (now 3 cards: to 0, 1, keeps one)
    expect(s.seats[1]!.hand.length + s.seats[2]!.hand.length + s.seats[0]!.hand.length).toBe(5);
    expect(ctx.asked.filter(d => d.kind === 'chooseHandCard').map(d => d.seat)).toEqual([1, 1, 2, 2, 2]);
    s.discard.pop();
    expect(everything(s)).toEqual(before);
  });

  it('Redistribution with empty hands: nothing happens', async () => {
    const s = makeState([{}, {}]);
    const ctx = await immediate(s, 18);
    expect(ctx.asked).toEqual([]);
  });
});

describe('expansion pack cards', () => {
  it('Reshuffle: the discard pile (with the card) goes into the draw pile', async () => {
    const s = makeState([{ hand: [45] }, {}], { draw: [14], discard: [7, 19] });
    await play(s, 45);
    expect(counts(s.draw)).toEqual(counts([14, 7, 19, 45]));
    expect(s.discard).toEqual([]);
  });

  it('Give It All Away: the whole hand goes to the others', async () => {
    const s = makeState([{ hand: [46, 14, 7, 19] }, {}, {}]);
    await play(s, 46);
    expect(s.seats[0]!.hand).toEqual([]);
    expect(s.seats[1]!.hand).toEqual([14, 19]);
    expect(s.seats[2]!.hand).toEqual([7]);
  });

  it('Fresh Start: everyone still in discards their hand and draws 5', async () => {
    const s = makeState([{ hand: [47, 14] }, { hand: [7] }, { hand: [19], left: true }], { draw: Array(12).fill(W1) });
    await play(s, 47);
    expect(s.seats[0]!.hand).toHaveLength(5);
    expect(s.seats[1]!.hand).toHaveLength(5);
    expect(s.seats[2]!.hand).toEqual([19]);
    expect(s.discard).toEqual([47, 14, 7]);
  });

  it('Double Time: 2 more actions', async () => {
    const s = makeState([{ hand: [48] }, {}], { actionsLeft: 1 });
    await play(s, 48);
    expect(s.actionsLeft).toBe(3);
  });

  it('Hand Swap swaps whole hands; blockable', async () => {
    const s = makeState([{ hand: [49, 14] }, { hand: [7, 19] }]);
    await play(s, 49);
    expect(s.seats[0]!.hand).toEqual([7, 19]);
    expect(s.seats[1]!.hand).toEqual([14]);
    const b = makeState([{ hand: [49, 14] }, { hand: [20, 7] }]);
    await play(b, 49, { block: [true] });
    expect(b.seats[0]!.hand).toEqual([14]);
  });
});

describe('cards with no effect of their own', () => {
  it('are discarded', async () => {
    const s = makeState([{ hand: [14] }, {}]);
    expect((await play(s, 14)).ok).toBe(true);
    expect(s.discard).toEqual([14]);
  });
});
