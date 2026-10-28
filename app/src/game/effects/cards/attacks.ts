// Cards aimed at one opponent: Chinese Spy Balloon (5), Controlled Opposition (6), Stimulus Check (21),
// Democrat Border (9), Puppeteer (16), Quarantine (17), Hand Swap (49).
import type { EffectContext } from '../../contracts';
import type { CardId } from '../../types';
import { askOption, askWall, attack, cardName, findInHand, hand, others, seatName, takeRandom } from '../shared';

/**
 * 5 Chinese Spy Balloon: either take every Trump, then Trump Train, from a chosen opponent (up to 12),
 * or, if an opponent has a Train-guarded pair, remove that Trump Train (it goes to the discard pile).
 * Both can be blocked. Any opponent can be picked for "take", even one with no Trumps (as before).
 */
export async function spyBalloon(ctx: EffectContext): Promise<boolean> {
  // The card is discarded once the target has had their chance to block (so it's seen flying at them first)
  const guarded = ctx.state.trainGuards.filter(g => g.seat !== ctx.player && others(ctx).includes(g.seat));
  const choice = await askOption(ctx, ctx.player, guarded.length ? ['take', 'remove'] : ['take']);
  if (choice === 'remove') {
    const w = (await askWall(ctx, ctx.player, guarded))!;
    const blocked = await ctx.defend(w.seat, ctx.player, ctx.card);
    ctx.discard(ctx.card);
    if (blocked) return true;
    const at = ctx.state.trainGuards.findIndex(g => g.seat === w.seat && g.kind === w.kind);
    if (at >= 0) {
      ctx.state.trainGuards.splice(at, 1);
      ctx.discard(25);
      ctx.emit({ type: 'trainGuardRemoved', seat: ctx.player, target: w.seat, card: 25,
        text: 'The Trump Train was removed from ' + seatName(ctx, w.seat) + "'s " + cardName(w.kind) + '.' });
    }
    return true;
  }
  const { target, blocked } = await attack(ctx, others(ctx));
  ctx.discard(ctx.card);
  if (target === null || blocked) return true;
  const took: CardId[] = [];
  for (let i = 0; i < 12; i++) {
    let slot = findInHand(ctx, target, 26);
    if (slot < 0) slot = findInHand(ctx, target, 25);
    if (slot < 0) break;
    const c = ctx.takeFromHand(target, slot);
    ctx.addToHand(ctx.player, c);
    took.push(c);
  }
  ctx.emit({ type: 'cardMoved', seat: ctx.player, target, card: ctx.card, cards: took,
    text: seatName(ctx, ctx.player) + ' took ' + took.length + ' Trump card(s) from ' + seatName(ctx, target) + '.' + (took.length ? '' : ' They had none.') });
  return true;
}

/** 6 Controlled Opposition (2 random cards, blockable) and 21 Stimulus Check (3 random cards, not blockable). */
export async function steal(ctx: EffectContext): Promise<boolean> {
  const withCards = others(ctx).filter(s => hand(ctx, s).length > 0);
  const { target, blocked } = await attack(ctx, withCards, ctx.card === 6);
  ctx.discard(ctx.card);
  if (target === null || blocked) return true;
  const took: CardId[] = [];
  for (let i = 0; i < (ctx.card === 6 ? 2 : 3); i++) {
    const c = takeRandom(ctx, target);
    if (c === null) break;
    ctx.addToHand(ctx.player, c);
    took.push(c);
  }
  ctx.emit({ type: 'cardMoved', seat: ctx.player, target, card: ctx.card, cards: took,
    text: seatName(ctx, ctx.player) + ' took ' + took.length + ' card(s) from ' + seatName(ctx, target) + '.' });
  return true;
}

/**
 * 9 Democrat Border, 16 Puppeteer: the target gets only 1 action next turn; the card is held in their
 * limitNext (an older limit card there is discarded). 17 Quarantine: the target skips their next turn
 * (after drawing); if already quarantined the card is just discarded. Blocked: the card is discarded.
 * Quarantine can only be blocked here, when it's played (the old game asked again at the victim's turn).
 */
export async function limit(ctx: EffectContext): Promise<boolean> {
  const { target, blocked } = await attack(ctx, others(ctx));
  if (target === null || blocked) { ctx.discard(ctx.card); return true; }
  const seat = ctx.state.seats[target]!;
  if (ctx.card === 17) {
    if (seat.skipNext) { ctx.discard(17); return true; }
    seat.skipNext = true;
    seat.skipBy = ctx.player;
    ctx.emit({ type: 'quarantined', seat: ctx.player, target, card: 17, text: seatName(ctx, target) + ' will skip their next turn.' });
    return true;
  }
  if (seat.limitNext > 0) ctx.discard(seat.limitNext);
  seat.limitNext = ctx.card;
  ctx.emit({ type: 'limited', seat: ctx.player, target, card: ctx.card, text: seatName(ctx, target) + ' gets only 1 action next turn.' });
  return true;
}

/** 49 Hand Swap (pack card): swap whole hands with an opponent; blockable. */
export async function handSwap(ctx: EffectContext): Promise<boolean> {
  const { target, blocked } = await attack(ctx, others(ctx));
  ctx.discard(ctx.card);
  if (target === null || blocked) return true;
  const me = ctx.state.seats[ctx.player]!, them = ctx.state.seats[target]!;
  [me.hand, them.hand] = [them.hand, me.hand];
  ctx.emit({ type: 'cardMoved', seat: ctx.player, target, card: 49, text: seatName(ctx, ctx.player) + ' swapped hands with ' + seatName(ctx, target) + '.' });
  return true;
}
