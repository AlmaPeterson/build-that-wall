// The bot that plays turns: Easy and Medium think straight away (player.ts), Hard plays the strategy learned in the
// bots' simulator (strategy.ts, learned.json), and Extra Hard ('insane') starts from that strategy and tries its
// moves in practice games first (insane.ts).
import type { BotMemory, BotPlayer } from '../contracts';
import { thinkInsane } from './insane';
import { think } from './player';
import { level } from './shared';
import { LEARNED, thinkWith } from './strategy';

export function createBotPlayer(memory: BotMemory): BotPlayer {
  return {
    nextAction: (api, seat) => {
      const lvl = level(api.state, seat);
      if (lvl === 'insane') return thinkInsane(api, seat, memory);
      if (lvl === 'hard') return thinkWith(api, seat, memory, LEARNED);
      return think(api, seat, memory);
    },
  };
}
