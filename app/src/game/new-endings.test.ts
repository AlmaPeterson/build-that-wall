// The two newer endings: First to 50 Miles and the Timed Game.
import { describe, expect, it } from 'vitest';
import { createLocalGame } from './local';
import { MILES_TO_WIN, type GameSettings } from './types';
import { milesOf } from './bots/shared';

const settings = (ending: 5 | 6, extra: Partial<GameSettings> = {}): GameSettings => ({
  players: 2, bots: 2, difficulties: ['hard', 'hard'], names: [], ending, endingTimes: 1,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [], ...extra,
});

describe('new endings', () => {
  it('First to 50 Miles: someone reaches 50 and the game ends after the final round', async () => {
    for (const seed of [11, 12, 13]) {
      const g = createLocalGame({ settings: settings(5), seed });
      await g.start();
      const s = g.state;
      expect(s.over).not.toBeNull();
      expect(Math.max(...s.seats.map((_, i) => milesOf(s, i)))).toBeGreaterThanOrEqual(MILES_TO_WIN - 16);   // walls can be lost in the final round
      expect(s.over!.reason).toMatch(/reached 50 miles/);
    }
  });

  it('First to __ Miles uses the number typed', async () => {
    const g = createLocalGame({ settings: settings(5, { miles: 20 }), seed: 5 });
    await g.start();
    expect(g.state.over!.reason).toMatch(/reached 20 miles/);
  });

  it("Timed Game: when the minutes are up, everyone gets one last turn and the game ends", async () => {
    let now = 0;
    const events: string[] = [];
    const g = createLocalGame({ settings: settings(6, { minutes: 10 }), seed: 4, now: () => now, emit: e => { if (e.type === 'turnStart') now += 60_000; if (e.type === 'finalRound' || e.type === 'gameOver') events.push(e.text); } });
    // A minute passes every turn: the clock runs out after 10 turns
    await g.start();
    expect(g.state.over).not.toBeNull();
    expect(events[0]).toMatch(/Time's up/);
    expect(g.state.timeUsed).toBeGreaterThanOrEqual(10 * 60_000);
    expect(g.state.turnCount).toBeLessThanOrEqual(14);
  });

  it('the deck running out does not end these games', async () => {
    let turns = 0;
    const capped = createLocalGame({
      settings: settings(6, { minutes: 600 }), seed: 9,
      beforeTurn: async () => { if (++turns > 90) throw new Error('stop'); },
    });
    await capped.start().catch(() => {});
    expect(capped.state.final).toBeNull();
    expect(capped.state.exhaustCount).toBeGreaterThan(0);
  }, 60_000);
});
