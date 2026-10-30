// Debt (7), Trump (26) and Trump Train (25). Cards › Debt Start / Debt Resolve, Trump Start, Train Start.
import type { EffectContext } from '../../contracts';
import { askOption, askWall, cardName, debtTargets, findInHand, seatName, trainPairs } from '../shared';

/**
 * 7 Debt: pick an opponent's wall (fewer than 3 of that kind, not Train-guarded); backing out costs
 * nothing. Then the Debt is discarded. If the owner holds Savings they may pay with it (Savings
 * discarded, wall stays); otherwise one section of that wall becomes the player's.
 */
export async function debt(ctx: EffectContext): Promise<boolean> {
  const targets = debtTargets(ctx, ctx.player);
  const w = await askWall(ctx, ctx.player, targets, true);
  if (!w) return false;
  // Discarded after the owner's Savings answer, so the Debt is seen flying at them first
  const savings = findInHand(ctx, w.seat, 19);
  const paid = savings >= 0 && await ctx.decide({ kind: 'paySavings', seat: w.seat, attacker: ctx.player, wall: w.kind });
  ctx.discard(7);
  if (paid) {
    ctx.discard(ctx.takeFromHand(w.seat, findInHand(ctx, w.seat, 19)));
    ctx.emit({ type: 'savings', seat: w.seat, target: ctx.player, card: 19, text: seatName(ctx, w.seat) + ' paid the Debt with a Savings card.' });
    return true;
  }
  ctx.moveWall(w, { walls: ctx.player });
  ctx.emit({ type: 'wallMoved', seat: ctx.player, target: w.seat, card: w.kind,
    text: seatName(ctx, ctx.player) + ' took ' + cardName(w.kind) + ' from ' + seatName(ctx, w.seat) + '.' });
  return true;
}

/** 26 Trump: discard it and draw 3 cards. */
export async function trump(ctx: EffectContext): Promise<boolean> {
  ctx.discard(26);
  const drawn = ctx.draw(ctx.player, 3);
  ctx.emit({ type: 'draw', seat: ctx.player, card: 26, cards: drawn, text: seatName(ctx, ctx.player) + ' drew ' + drawn.length + ' card(s).' });
  return true;
}

/**
 * 25 Trump Train: draw 3 (card discarded), or protect a built pair (exactly 2 of a kind, not guarded):
 * the card is then held in trainGuards. Protect is only offered when there is a pair. Backing out of
 * either question costs nothing.
 */
export async function trumpTrain(ctx: EffectContext): Promise<boolean> {
  const pairs = trainPairs(ctx, ctx.player);
  const choice = await askOption(ctx, ctx.player, pairs.length ? ['draw', 'protect'] : ['draw'], true);
  if (choice === null) return false;
  if (choice === 'draw') {
    ctx.discard(25);
    const drawn = ctx.draw(ctx.player, 3);
    ctx.emit({ type: 'draw', seat: ctx.player, card: 25, cards: drawn, text: seatName(ctx, ctx.player) + ' drew ' + drawn.length + ' card(s).' });
    return true;
  }
  const w = await askWall(ctx, ctx.player, pairs, true);
  if (!w) return false;
  ctx.holdTrainGuard(w.seat, w.kind, 25);
  ctx.emit({ type: 'trainGuard', seat: ctx.player, card: 25, text: cardName(w.kind) + ' is safe from Debt now.' });
  return true;
}
