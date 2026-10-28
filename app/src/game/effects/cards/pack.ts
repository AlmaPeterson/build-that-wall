// Expansion pack cards (not in the base deck yet): Give It All Away (46), Fresh Start (47), Double Time (48).
// Reshuffle (45) is in piles.ts and Hand Swap (49) in attacks.ts.
import type { EffectContext } from '../../contracts';
import { announce, distribute, hand, seatName } from '../shared';

/** 46 Give It All Away: hand out the whole hand to the other players, none to yourself. */
export async function giveAllAway(ctx: EffectContext): Promise<boolean> {
  ctx.discard(46);
  await distribute(ctx, ctx.player, 'all', false);
  announce(ctx, seatName(ctx, ctx.player) + ' gave their whole hand away.');
  return true;
}

/** 47 Fresh Start: every player still in the game discards their hand and draws 5. */
export async function freshStart(ctx: EffectContext): Promise<boolean> {
  ctx.discard(47);
  for (const s of ctx.activeSeats()) {
    const h = hand(ctx, s);
    while (h.length) ctx.discard(ctx.takeFromHand(s, 0));
    ctx.draw(s, 5);
  }
  announce(ctx, 'Fresh Start: everyone discarded their hand and drew 5 new cards.');
  return true;
}

/** 48 Double Time: 2 extra actions this turn. */
export async function doubleTime(ctx: EffectContext): Promise<boolean> {
  ctx.discard(48);
  ctx.addActions(2);
  announce(ctx, seatName(ctx, ctx.player) + ' gets 2 extra actions.');
  return true;
}
