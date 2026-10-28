// Play Immediately cards (1, 2, 8, 10, 12, 15, 18, 24). The engine has already discarded the card;
// ctx.player is the player who drew it. Self-Defense blocks your own bad card (section 8).
import type { EffectContext } from '../../contracts';
import type { Seat } from '../../types';
import { announce, askHandCard, askSeat, askWall, cardName, distribute, findInHand, hand, others, qualifyingSlots, seatName } from '../shared';

/** 1 Abduction: discard a Man Hour, unless blocked. No Man Hour: no effect. */
async function abduction(ctx: EffectContext): Promise<void> {
  if (findInHand(ctx, ctx.player, 14) < 0) { announce(ctx, 'Abduction: no Man Hour to discard.'); return; }
  if (await ctx.defend(ctx.player, ctx.player, 1)) return;
  ctx.discard(ctx.takeFromHand(ctx.player, findInHand(ctx, ctx.player, 14)));
  ctx.emit({ type: 'discard', seat: ctx.player, card: 14, text: seatName(ctx, ctx.player) + ' discarded a Man Hour.' });
}

/** 2 Afghanistan Pull Out: give one of your built walls (not in a set of 3, not guarded) to an opponent. It stays built, on their board. */
async function afghanistan(ctx: EffectContext): Promise<void> {
  if (!ctx.eligibleWalls(ctx.player).length) { announce(ctx, 'Afghanistan Pull Out: no wall can be given away. Sets of 3 are safe.'); return; }
  if (await ctx.defend(ctx.player, ctx.player, 2)) return;
  const w = await askWall(ctx, ctx.player, ctx.eligibleWalls(ctx.player));
  const to = await askSeat(ctx, ctx.player, others(ctx));
  if (!w || to === null) return;
  ctx.moveWall(w, { walls: to });
  ctx.emit({ type: 'wallMoved', seat: ctx.player, target: to, card: w.kind,
    text: seatName(ctx, ctx.player) + ' gave ' + cardName(w.kind) + ' to ' + seatName(ctx, to) + '. It stays built on their board.' });
}

/** 8 Deep State (whole hand) and 24 Trafficking (Savings, Trump, Trump Train, Man Hour): hand them out, unless blocked. */
async function handOut(ctx: EffectContext): Promise<void> {
  if (await ctx.defend(ctx.player, ctx.player, ctx.card)) return;
  await distribute(ctx, ctx.player, ctx.card === 8 ? 'all' : 'traffic');
  announce(ctx, seatName(ctx, ctx.player) + ' handed cards around the table.');
}

/** 12 Lawfare: hand out the Wall Sections in your hand. Not blockable. */
async function lawfare(ctx: EffectContext): Promise<void> {
  await distribute(ctx, ctx.player, 'walls');
  announce(ctx, seatName(ctx, ctx.player) + ' handed their walls around the table.');
}

/**
 * 10 Fake News: if everyone has the same miles, no effect. Otherwise each player not tied for fewest
 * miles who holds a Wall Section, Trump or Trump Train gives one (their choice) to a lowest player;
 * with several lowest players they receive in turn, in seat order. Not blockable.
 */
async function fakeNews(ctx: EffectContext): Promise<void> {
  const seats = ctx.activeSeats();
  const miles = new Map(seats.map(s => [s, ctx.miles(s)]));
  const lo = Math.min(...miles.values()), hi = Math.max(...miles.values());
  if (lo === hi) { announce(ctx, 'Fake News: everyone has the same miles. No effect.'); return; }
  const lowest = seats.filter(s => miles.get(s) === lo);
  let next = 0;
  for (const giver of seats) {
    if (lowest.includes(giver)) continue;
    const slots = qualifyingSlots(ctx, giver, 'fake');
    if (!slots.length) continue;
    const to = lowest[next]!;
    next = (next + 1) % lowest.length;
    const slot = (await askHandCard(ctx, giver, 'give', slots, false, to))!;
    const card = ctx.takeFromHand(giver, slot);
    ctx.addToHand(to, card);
    ctx.emit({ type: 'cardMoved', seat: giver, target: to, card, text: seatName(ctx, giver) + ' gave a card to ' + seatName(ctx, to) + '.' });
  }
  announce(ctx, 'Fake News: cards went to the lowest wall builder.');
}

/** 15 Mostly Peaceful Riot: in seat order, everyone with an eligible built wall pulls one back into their own hand, unless they block. */
async function riot(ctx: EffectContext): Promise<void> {
  for (const s of ctx.activeSeats()) {
    if (!ctx.eligibleWalls(s).length) continue;
    if (await ctx.defend(s, ctx.player, 15)) continue;
    const w = await askWall(ctx, s, ctx.eligibleWalls(s));
    if (!w) continue;
    ctx.moveWall(w, { hand: s });
    ctx.emit({ type: 'wallMoved', seat: s, target: s, card: w.kind, text: seatName(ctx, s) + ' pulled ' + cardName(w.kind) + ' back into their hand.' });
  }
  announce(ctx, 'Mostly Peaceful Riot: everyone pulled a wall back into their hand.');
}

/** 18 Redistribution: everyone tied for the most cards in hand (if any) hands out their whole hand, in seat order. Not blockable. */
async function redistribution(ctx: EffectContext): Promise<void> {
  const seats = ctx.activeSeats();
  const most = Math.max(0, ...seats.map(s => hand(ctx, s).length));
  const givers: Seat[] = most > 0 ? seats.filter(s => hand(ctx, s).length === most) : [];
  for (const g of givers) await distribute(ctx, g, 'all');
  announce(ctx, 'Redistribution: ' + givers.length + ' player(s) handed out their whole hand.');
}

const IMMEDIATES: Record<number, (ctx: EffectContext) => Promise<void>> = {
  1: abduction, 2: afghanistan, 8: handOut, 10: fakeNews, 12: lawfare, 15: riot, 18: redistribution, 24: handOut,
};

export async function runImmediate(ctx: EffectContext): Promise<void> {
  const fx = IMMEDIATES[ctx.card];
  if (fx) await fx(ctx);
}

export const hasImmediate = (card: number): boolean => card in IMMEDIATES;
