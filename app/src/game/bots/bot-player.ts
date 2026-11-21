// The bot that plays turns: Easy, Medium and Hard think straight away (player.ts); Insane tries its moves first (insane.ts).
import type { BotMemory, BotPlayer } from '../contracts';
import { thinkInsane } from './insane';
import { think } from './player';
import { level } from './shared';

export function createBotPlayer(memory: BotMemory): BotPlayer {
  return {
    nextAction: (api, seat) => (level(api.state, seat) === 'insane' ? thinkInsane(api, seat, memory) : think(api, seat, memory)),
  };
}
