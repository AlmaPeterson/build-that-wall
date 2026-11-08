// Cards that build walls for free: Assassin (3), Legal Immigration (13), Voting Machine (28), Toilet Paper (23).
import type { EffectContext } from '../../contracts';
import { announce, askHandCards, buildFreeLoop, buildSlots, cardName, hand, seatName } from '../shared';

/**
 * 3: up to 2 free, 13: up to 3 free, 28: up to 2 free. The card's own cost (if any) was already paid.
 * The walls are picked first, then the card is discarded and they're built, so the board shows it in that order.
 */
export async function freeBuild(ctx: EffectContext): Promise<boolean> {
  const built = await buildFreeLoop(ctx, ctx.card === 13 ? 3 : 2, ctx.card);
  announce(ctx, seatName(ctx, ctx.player) + ' built ' + built + ' wall section(s) for free with ' + cardName(ctx.card) + '.');
  return true;
}

/** Wall kinds with 2+ copies in the player's hand, with the first slot of each (Cards › define tp sets). */
function pairKinds(ctx: EffectContext): { kind: number; slot: number }[] {
  const h = hand(ctx, ctx.player), out: { kind: number; slot: number }[] = [];
  for (let kind = 29; kind <= 44; kind++) {
    if (h.filter(c => c === kind).length > 1) out.push({ kind, slot: h.indexOf(kind) });
  }
  return out;
}

/**
 * 23 Toilet Paper: build a set: every copy of one wall kind in hand (2 or 3) for free. The first set is
 * covered by the card's own action; each further set costs 1 more action; the player may stop after
 * any set (at least one if there is one). The player picks the sets in one go, each by one of its cards;
 * then the card is discarded and the sets are built.
 */
export async function toiletPaper(ctx: EffectContext): Promise<boolean> {
  const kinds = pairKinds(ctx);
  const picks = await askHandCards(ctx, ctx.player, kinds.map(k => k.slot), 1, 1 + Math.max(0, ctx.state.actionsLeft));
  ctx.discard(ctx.card);
  // Every copy of each chosen kind, at most 3 (a set)
  const h = hand(ctx, ctx.player), chosen = picks.map(s => h[s]!);
  buildSlots(ctx, chosen.flatMap(kind => h.flatMap((c, i) => (c === kind ? [i] : [])).slice(0, 3)));
  const sets = picks.length;
  if (sets > 1) ctx.spendActions(sets - 1);
  announce(ctx, seatName(ctx, ctx.player) + ' built ' + sets + ' set(s) with Toilet Paper.');
  return true;
}
