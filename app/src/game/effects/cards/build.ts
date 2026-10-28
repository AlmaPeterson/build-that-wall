// Cards that build walls for free: Assassin (3), Legal Immigration (13), Voting Machine (28), Toilet Paper (23).
import type { EffectContext } from '../../contracts';
import { announce, askHandCard, buildFreeLoop, cardName, hand, seatName } from '../shared';

/** 3: up to 2 free, 13: up to 3 free, 28: up to 2 free. The card's own cost (if any) was already paid. */
export async function freeBuild(ctx: EffectContext): Promise<boolean> {
  ctx.discard(ctx.card);
  const built = await buildFreeLoop(ctx, ctx.card === 13 ? 3 : 2);
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
 * any set (the first choice can't be cancelled). The player picks a set by picking one of its cards.
 */
export async function toiletPaper(ctx: EffectContext): Promise<boolean> {
  ctx.discard(ctx.card);
  let sets = 0;
  for (;;) {
    const kinds = pairKinds(ctx);
    if (!kinds.length || (sets > 0 && ctx.state.actionsLeft < 1)) break;
    const slot = await askHandCard(ctx, ctx.player, 'build', kinds.map(k => k.slot), sets > 0);
    if (slot === null) break;
    const kind = hand(ctx, ctx.player)[slot]!;
    for (let i = 0; i < 3; i++) {
      const at = hand(ctx, ctx.player).indexOf(kind);
      if (at < 0) break;
      ctx.buildFree(ctx.player, at);
    }
    if (sets > 0) ctx.spendActions(1);
    sets++;
  }
  announce(ctx, seatName(ctx, ctx.player) + ' built ' + sets + ' set(s) with Toilet Paper.');
  return true;
}
