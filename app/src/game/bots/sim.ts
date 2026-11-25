// The bots' own simulator: whole games between bots, with no people playing or watching (no animations, no
// screen). The trainer (tools/train-bot.ts) uses it to learn the Extra Hard strategy, and the tests use it to
// check the levels are really different.
import type { BotMemory, GameApi } from '../contracts';
import { cardRules } from '../effects';
import { Game } from '../engine/game';
import { createGame } from '../engine/setup';
import { DEFAULT_SETTINGS } from '../types';
import type { Action, Decider, Difficulty, GameSettings, Seat } from '../types';
import { createBotMemory } from './memory';
import { createBotDecider } from './decider';
import { createBotPlayer } from './bot-player';
import { thinkWith, type Strategy } from './strategy';

/** A seat in a simulated game: a bot level, or a strategy (answering questions like a Hard bot). */
export type SimPlayer = Difficulty | Strategy;

function forgetful(): BotMemory {
  const m = new Map<string, string>();
  return createBotMemory({ get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } });
}

/** Play one whole game; returns the winners' seats (more than one on a tie). */
export async function simulate(players: SimPlayer[], seed: number, settings: Partial<GameSettings> = {}): Promise<Seat[]> {
  const levels = players.map(p => (typeof p === 'string' ? p : 'hard'));
  const state = createGame({ ...DEFAULT_SETTINGS, ...settings, players: players.length, bots: players.length, difficulties: levels, names: [] }, seed);
  const memory = forgetful();
  const levelBot = createBotPlayer(memory);
  const deciders = new Map<Seat, Decider>();
  const game = new Game(state, {
    rules: cardRules,
    bot: {
      nextAction: (api: GameApi, seat: Seat): Action | Promise<Action> => {
        const p = players[seat]!;
        return typeof p === 'string' ? levelBot.nextAction(api, seat) : thinkWith(api, seat, memory, p);
      },
    },
    deciderFor: seat => {
      if (!deciders.has(seat)) deciders.set(seat, createBotDecider(seat, memory));
      return deciders.get(seat)!;
    },
    emit: () => {},
  });
  await game.start();
  return state.over?.winners ?? [];
}

/**
 * How often `player` wins against `others`, over `games` games with seeds from `seed0`. It takes every seat in
 * turn, so going first or last doesn't decide it. A shared win counts as a share.
 */
export async function winRate(player: SimPlayer, others: SimPlayer[], games: number, seed0 = 1, settings: Partial<GameSettings> = {}): Promise<number> {
  let wins = 0;
  const n = others.length + 1;
  for (let g = 0; g < games; g++) {
    const at = g % n;
    const table = [...others];
    table.splice(at, 0, player);
    const winners = await simulate(table, seed0 + g, settings);
    if (winners.includes(at)) wins += 1 / winners.length;
  }
  return wins / games;
}
