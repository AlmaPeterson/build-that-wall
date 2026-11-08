// Cards that pick from the piles: Freedom of the Press (11), Supreme Court Nominee (22),
// Vote Recount (27), and the pack card Reshuffle (45).
import type { EffectContext } from '../../contracts';
import { announce, cardName, poolPick, seatName, takeFromPile } from '../shared';

/**
 * 22: up to 3 from the draw pile into the hand, then shuffle the draw pile.
 * 27: up to 3 from the discard pile into the hand; then the Vote Recount card goes to the discard pile.
 * 11: up to 4 from both piles (from whichever pile the player picked them in)
 *     into jail with the Freedom of the Press card; jail empties at turnCount + 3 × players; then shuffle.
 */
export async function pilePick(ctx: EffectContext): Promise<boolean> {
  const { state, card } = ctx;
  if (card === 22) ctx.discard(22);
  const draw = card !== 27 ? state.draw : [], split = draw.length;
  const pool = [...draw, ...(card !== 22 ? state.discard : [])];
  const at = await poolPick(ctx, pool, card === 11 ? 4 : 3, card === 11 ? split : undefined);
  const picks = at.map(i => pool[i]!);
  for (const i of at) {
    takeFromPile(i < split ? state.draw : state.discard, pool[i]!);
    if (card === 11) state.jail.push(pool[i]!);
    else ctx.addToHand(ctx.player, pool[i]!);
  }
  // Discarded before it's announced (after the picks, so it can't pick itself), so it's seen going to the pile
  if (card === 27) ctx.discard(27);
  if (card === 11) {
    ctx.holdInJail(11);
    state.jailRelease = state.turnCount + 3 * state.seats.length;
    ctx.emit({ type: 'jail', seat: ctx.player, card: 11, cards: picks,
      text: seatName(ctx, ctx.player) + ' jailed ' + picks.length + ' card(s) with Freedom of the Press.' });
  } else {
    announce(ctx, seatName(ctx, ctx.player) + ' took ' + picks.length + ' card(s) with ' + cardName(card) + '.');
  }
  if (card === 22 || card === 11) ctx.shuffleDraw();
  return true;
}

/** 45 Reshuffle (pack card): the whole discard pile (including this card) goes into the draw pile, then shuffle. */
export async function reshuffle(ctx: EffectContext): Promise<boolean> {
  ctx.discard(45);
  const n = ctx.state.discard.length;
  ctx.state.draw.push(...ctx.state.discard);
  ctx.state.discard.length = 0;
  ctx.shuffleDraw();
  ctx.emit({ type: 'reshuffle', seat: ctx.player, card: 45, text: n + ' cards went back into the draw pile.' });
  return true;
}
