// Fakes for the engine tests: stub card rules, scripted deciders and bots, and quick game setup.
import type { BotPlayer, CardRules, EffectContext, GameApi } from '../contracts';
import type { Action, Answer, CardId, Decider, Decision, GameEvent, GameSettings, GameState, Seat } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { Game } from './game';
import { createGame } from './setup';

export const MH = 14, WALL1 = 29, WALL2 = 30, WALL3 = 31, WALL4 = 32;

export interface StubRules extends CardRules {
  runs: { seat: Seat; card: CardId }[];
  immediates: { seat: Seat; card: CardId }[];
}

/**
 * Every card can be played except Savings/Self-Defense; playing just discards it.
 * `effects` overrides a card's effect (return false to back out); `immediate` overrides Play Immediately cards.
 */
export function stubRules(
  effects: Record<number, (ctx: EffectContext) => Promise<boolean>> = {},
  immediate?: (ctx: EffectContext) => Promise<void>,
): StubRules {
  const rules: StubRules = {
    runs: [],
    immediates: [],
    check: (_s, _seat, card) => (card === 19 || card === 20 ? { ok: false, reason: 'Only used to block.' } : { ok: true }),
    run: async ctx => {
      rules.runs.push({ seat: ctx.player, card: ctx.card });
      const fx = effects[ctx.card];
      if (fx) return fx(ctx);
      ctx.discard(ctx.card);
      return true;
    },
    runImmediate: async ctx => {
      rules.immediates.push({ seat: ctx.player, card: ctx.card });
      if (immediate) await immediate(ctx);
    },
  };
  return rules;
}

/** Answers every decision with `answer(d)`; remembers what was asked. */
export function scriptedDecider(answer: (d: Decision) => unknown = d => (d.kind === 'block' ? true : null)) {
  const asked: Decision[] = [];
  const decider: Decider = {
    decide: async <D extends Decision>(d: D): Promise<Answer<D>> => { asked.push(d); return answer(d) as Answer<D>; },
  };
  return { decider, asked };
}

/** A bot that plays the given actions in order, then ends its turn. */
export function scriptedBot(script: Action[] = []): BotPlayer & { calls: number } {
  const bot = {
    calls: 0,
    nextAction(_api: GameApi, _seat: Seat): Action { bot.calls++; return script.shift() ?? { type: 'endTurn' }; },
  };
  return bot;
}

/** A 2-player game of humans (unless settings say otherwise) with a known draw pile. */
export function setup(opts: {
  settings?: Partial<GameSettings>;
  seed?: number;
  draw?: CardId[];                 // top of the pile is the LAST item
  hands?: CardId[][];              // given instead of dealing; then call startTurn via game.begin()
  rules?: StubRules;
  answer?: (d: Decision) => unknown;
  bot?: BotPlayer;
} = {}) {
  const state = createGame({ ...DEFAULT_SETTINGS, players: 2, bots: 0, firstSeat: 0, ...opts.settings }, opts.seed ?? 1);
  if (opts.draw) state.draw = [...opts.draw];
  const rules = opts.rules ?? stubRules();
  const { decider, asked } = scriptedDecider(opts.answer);
  const events: GameEvent[] = [];
  const bot = opts.bot ?? scriptedBot();
  const game = new Game(state, { rules, deciderFor: () => decider, bot, emit: e => events.push(e) });
  return { state, game, rules, asked, events, bot };
}

/** Fill a pile with harmless cards (Man Hours). */
export const filler = (n: number): CardId[] => Array<CardId>(n).fill(MH);

/** Give seats hands and start the first turn without dealing (the draw pile is used only for turn draws). */
export async function begin(game: Game, state: GameState, hands: CardId[][]): Promise<void> {
  hands.forEach((h, i) => { state.seats[i]!.hand = [...h]; });
  state.turn = 0;
  await game.beginTurn();
}
