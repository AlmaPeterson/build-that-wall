// A game on this device: the engine with the real card rules and bots. Humans answer through
// `humanDecider` (the UI); bots learn from what the humans do.
import { createBotDecider, createBotMemory, createBotPlayer, learnFromEvent } from './bots';
import type { BotMemory } from './contracts';
import { cardRules } from './effects';
import { Game } from './engine/game';
import { createGame } from './engine/setup';
import type { Decider, Emit, GameSettings, Seat } from './types';

export interface LocalGameOptions {
  settings: GameSettings;
  seed: number;
  /** Answers decisions for human seats (the UI). Not needed in watch mode (bots only). */
  humanDecider?: (seat: Seat) => Decider;
  /** Bot memory; defaults to one that forgets everything when the page closes. */
  memory?: BotMemory;
  /** false in Test Mode: bots don't learn from this game. */
  learn?: boolean;
  emit?: Emit;
  beforeTurn?(seat: Seat): Promise<void>;
}

export function createLocalGame(o: LocalGameOptions): Game {
  const state = createGame(o.settings, o.seed);
  const memory = o.memory ?? createBotMemory(inMemoryStore());
  const bots = new Map<Seat, Decider>();
  const noHuman: Decider = { decide: () => Promise.reject(new Error('No human decider for this game')) };
  return new Game(state, {
    rules: cardRules,
    bot: createBotPlayer(memory),
    deciderFor: seat => {
      if (!state.seats[seat]?.bot) return o.humanDecider?.(seat) ?? noHuman;
      if (!bots.has(seat)) bots.set(seat, createBotDecider(seat, memory));
      return bots.get(seat)!;
    },
    emit: e => {
      if (o.learn !== false) learnFromEvent(memory, e, state);
      o.emit?.(e);
    },
    beforeTurn: o.beforeTurn,
  });
}

function inMemoryStore() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); } };
}
