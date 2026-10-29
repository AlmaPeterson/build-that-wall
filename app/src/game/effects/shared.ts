// Helpers the card effects share: asking players (with answers checked), handing cards out,
// picking from piles, free building and attacks that can be blocked.
// Rules: docs/game-rules.md section 9; blocks: Cards › define distribute, pool pick, build free, qual.
import { cardById } from '../../data/cards';
import type { EffectContext } from '../contracts';
import { isWall } from '../cardinfo';
import type { CardId, Seat, WallRef } from '../types';

export const cardName = (id: CardId): string => cardById(id).name;
export const seatName = (ctx: EffectContext, seat: Seat): string => ctx.state.seats[seat]?.name ?? 'Player ' + (seat + 1);
export const hand = (ctx: EffectContext, seat: Seat): CardId[] => ctx.state.seats[seat]!.hand;

/** Slot of the first `card` in a seat's hand, or -1. */
export const findInHand = (ctx: EffectContext, seat: Seat, card: CardId): number => hand(ctx, seat).indexOf(card);

/** Other seats still in the game, clockwise from the player. */
export const others = (ctx: EffectContext, seat: Seat = ctx.player): Seat[] => ctx.opponents(seat);

// ---- asking, with answers checked: a bad or missing answer falls back to the first option
// (or to "cancel" where cancelling is allowed), so a buggy UI or bot can't break the rules.

export async function askSeat(ctx: EffectContext, seat: Seat, options: Seat[], cancellable = false): Promise<Seat | null> {
  if (!options.length) return null;
  const a = await ctx.decide({ kind: 'chooseSeat', seat, card: ctx.card, options, cancellable });
  if (a !== null && options.includes(a)) return a;
  return cancellable && a === null ? null : options[0]!;
}

export async function askWall(ctx: EffectContext, seat: Seat, options: WallRef[], cancellable = false): Promise<WallRef | null> {
  if (!options.length) return null;
  const a = await ctx.decide({ kind: 'chooseWall', seat, card: ctx.card, options, cancellable });
  const hit = a && options.find(o => o.seat === a.seat && o.kind === a.kind);
  if (hit) return hit;
  return cancellable && a === null ? null : options[0]!;
}

export async function askHandCard(ctx: EffectContext, seat: Seat, purpose: 'give' | 'build', options: number[],
  optional: boolean, to?: Seat): Promise<number | null> {
  if (!options.length) return null;
  const d = { kind: 'chooseHandCard' as const, seat, card: ctx.card, purpose, options, optional, ...(to === undefined ? {} : { to }) };
  const a = await ctx.decide(d);
  if (a !== null && options.includes(a)) return a;
  return optional && a === null ? null : options[0]!;
}

export async function askOption(ctx: EffectContext, seat: Seat, options: string[], cancellable = false): Promise<string | null> {
  if (!options.length) return null;
  const a = await ctx.decide({ kind: 'chooseOption', seat, card: ctx.card, options, cancellable });
  if (a !== null && options.includes(a)) return a;
  return cancellable && a === null ? null : options[0]!;
}

// ---- which cards qualify (Cards › define qual)

export type GiveKind = 'all' | 'walls' | 'traffic' | 'fake';
const TRAFFIC: readonly CardId[] = [14, 19, 25, 26];

export function qualifies(card: CardId, kind: GiveKind): boolean {
  if (kind === 'all') return true;
  if (kind === 'walls') return isWall(card);
  if (kind === 'fake') return isWall(card) || card === 25 || card === 26;
  return TRAFFIC.includes(card);
}

export const qualifyingSlots = (ctx: EffectContext, seat: Seat, kind: GiveKind): number[] =>
  hand(ctx, seat).flatMap((c, i) => (qualifies(c, kind) ? [i] : []));

/**
 * Hand out cards around the table (Cards › define distribute): starting with the next seat after the
 * giver and going clockwise, the giver gives one qualifying card per seat until none are left.
 * The giver's own turn in the round is "keep one for yourself": that card is set aside and goes back
 * into their hand at the end. Seats that left the game are skipped (fixed; the old game didn't).
 */
export async function distribute(ctx: EffectContext, giver: Seat, kind: GiveKind, includeSelf = true): Promise<number> {
  const order = [...ctx.opponents(giver), ...(includeSelf ? [giver] : [])];
  if (!order.length) return 0;
  const kept: CardId[] = [];
  let given = 0;
  for (let i = 0; i < 200; i++) {
    const slots = qualifyingSlots(ctx, giver, kind);
    if (!slots.length) break;
    const to = order[i % order.length]!;
    const slot = (await askHandCard(ctx, giver, 'give', slots, false, to))!;
    const card = ctx.takeFromHand(giver, slot);
    if (to === giver) { kept.push(card); continue; }
    ctx.addToHand(to, card);
    given++;
    ctx.emit({ type: 'cardMoved', seat: giver, target: to, card, text: seatName(ctx, giver) + ' gave a card to ' + seatName(ctx, to) + '.' });
  }
  for (const c of kept) ctx.addToHand(giver, c);
  return given;
}

/**
 * Pick up to `max` cards from a pool (Cards › define pool pick). The pool is every card in the piles;
 * the answer is card ids, checked against what is really there. Pack cards (45-49) can be picked
 * too (fixed; the old game only offered ids 1-44).
 */
export async function poolPick(ctx: EffectContext, pool: CardId[], max: number): Promise<CardId[]> {
  if (!pool.length || max < 1) return [];
  const answer = await ctx.decide({ kind: 'pickCards', seat: ctx.player, card: ctx.card, pool: [...pool], max });
  const left = [...pool], picks: CardId[] = [];
  for (const id of Array.isArray(answer) ? answer : []) {
    const at = left.indexOf(id);
    if (at < 0 || picks.length >= max) continue;
    left.splice(at, 1);
    picks.push(id);
  }
  return picks;
}

/** Remove one copy of `card` from a pile; true if it was there. */
export function takeFromPile(pile: CardId[], card: CardId): boolean {
  const at = pile.indexOf(card);
  if (at < 0) return false;
  pile.splice(at, 1);
  return true;
}

/**
 * Pick between `min` and `max` of `options` (hand slots) at once. The answer is checked: unknown or repeated
 * slots are dropped, extra ones cut off, and too few are topped up from the first options.
 */
export async function askHandCards(ctx: EffectContext, seat: Seat, options: number[], min: number, max: number): Promise<number[]> {
  max = Math.min(max, options.length);
  min = Math.min(min, max);
  if (max <= 0) return [];
  const h = hand(ctx, seat);
  const a = await ctx.decide({ kind: 'pickHandCards', seat, card: ctx.card, purpose: 'build', options, cards: options.map(i => h[i]!), min, max });
  const picks: number[] = [];
  for (const s of Array.isArray(a) ? a : []) if (options.includes(s) && !picks.includes(s) && picks.length < max) picks.push(s);
  for (const s of options) if (picks.length < min && !picks.includes(s)) picks.push(s);
  return picks;
}

/** Build the cards in these hand slots for free, in this order (each slot as it was before any of them was built). */
export function buildSlots(ctx: EffectContext, slots: number[]): void {
  const done: number[] = [];
  for (const s of slots) {
    ctx.buildFree(ctx.player, s - done.filter(d => d < s).length);
    done.push(s);
  }
}

/**
 * Build up to `max` Wall Sections from the hand for free; at least one if there is any (Cards › define build
 * free). The player picks them all in one go, then the card is discarded, then they're built.
 */
export async function buildFreeLoop(ctx: EffectContext, max: number, discard?: CardId): Promise<number> {
  const slots = await askHandCards(ctx, ctx.player, qualifyingSlots(ctx, ctx.player, 'walls'), 1, max);
  if (discard !== undefined) ctx.discard(discard);
  buildSlots(ctx, slots);
  return slots.length;
}

/** Pick an opponent for an attack, then let them block with Self-Defense. Returns the target, or null if blocked or no one to pick. */
export async function attack(ctx: EffectContext, options: Seat[], blockable = true): Promise<{ target: Seat | null; blocked: boolean }> {
  const target = await askSeat(ctx, ctx.player, options);
  if (target === null) return { target: null, blocked: false };
  if (blockable && await ctx.defend(target, ctx.player, ctx.card)) return { target, blocked: true };
  return { target, blocked: false };
}

/** Take a random card from a seat's hand (Controlled Opposition, Stimulus Check). */
export function takeRandom(ctx: EffectContext, from: Seat): CardId | null {
  const h = hand(ctx, from);
  if (!h.length) return null;
  return ctx.takeFromHand(from, ctx.randomInt(0, h.length - 1));
}

export function announce(ctx: EffectContext, text: string, extra: { target?: Seat; cards?: CardId[] } = {}): void {
  ctx.emit({ type: 'announce', seat: ctx.player, card: ctx.card, text, ...extra });
}

/** Built pairs (exactly 2 of a kind) a seat could protect with a Trump Train (Cards › define train sets). */
export function trainPairs(ctx: EffectContext, seat: Seat): WallRef[] {
  const out: WallRef[] = [];
  for (let kind = 29; kind <= 44; kind++) {
    if (ctx.wallCount(seat, kind) === 2 && !ctx.isGuarded({ seat, kind })) out.push({ seat, kind });
  }
  return out;
}

/** Opponent walls a Debt could take: fewer than 3 of that kind, not Train-guarded (Cards › define debt targets). */
export function debtTargets(ctx: EffectContext, seat: Seat): WallRef[] {
  return ctx.opponents(seat).flatMap(s => ctx.eligibleWalls(s));
}
