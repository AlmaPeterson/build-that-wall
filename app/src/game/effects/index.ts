// What every card does: the CardRules the engine uses (docs/game-rules.md sections 6-9).
import type { CardRules, EffectContext } from '../contracts';
import { isImmediate } from '../cardinfo';
import { freeBuild, toiletPaper } from './cards/build';
import { handSwap, limit, spyBalloon, steal } from './cards/attacks';
import { pilePick, reshuffle } from './cards/piles';
import { debt, trump, trumpTrain } from './cards/debt-trump';
import { runImmediate } from './cards/immediates';
import { doubleTime, freshStart, giveAllAway } from './cards/pack';
import { check } from './check';

type Run = (ctx: EffectContext) => Promise<boolean>;

const RUN: Record<number, Run> = {
  3: freeBuild, 13: freeBuild, 28: freeBuild, 23: toiletPaper,
  5: spyBalloon, 6: steal, 21: steal, 9: limit, 16: limit, 17: limit, 49: handSwap,
  11: pilePick, 22: pilePick, 27: pilePick, 45: reshuffle,
  7: debt, 26: trump, 25: trumpTrain,
  46: giveAllAway, 47: freshStart, 48: doubleTime,
};

export const cardRules: CardRules = {
  check,
  async run(ctx) {
    const fx = RUN[ctx.card];
    if (fx) return fx(ctx);
    ctx.discard(ctx.card);
    // A Play Immediately card played by hand (normally it's resolved as soon as it's drawn)
    if (isImmediate(ctx.card)) await runImmediate(ctx);
    // Anything else: discarded with no effect (the old game's "Play Card" path)
    return true;
  },
  runImmediate,
};

export { check };
