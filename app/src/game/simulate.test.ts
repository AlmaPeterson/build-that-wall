// Whole games, bots only, with the real engine, card rules and bots wired together.
// Every game must finish, and no card may ever appear or disappear.
import { describe, expect, it } from 'vitest';
import { baseDeck } from '../data/cards';
import { createLocalGame } from './local';
import type { Difficulty, Ending, GameEvent, GameSettings, GameState } from './types';

const DECK_SIZE = baseDeck().length;

/** Every card is somewhere: hands, walls, piles, jail, held as a 1-action limit, a Trump Train guard or a pending Quarantine. */
function cardsInGame(s: GameState): number {
  return s.draw.length + s.discard.length + s.jail.length + s.trainGuards.length +
    s.seats.reduce((n, seat) => n + seat.hand.length + seat.walls.length + (seat.limitNext ? 1 : 0) + (seat.skipNext ? 1 : 0), 0);
}

async function play(settings: GameSettings, seed: number) {
  const events: GameEvent[] = [];
  const problems: string[] = [];
  let game: ReturnType<typeof createLocalGame> | null = null;
  game = createLocalGame({
    settings, seed,
    emit: e => {
      events.push(e);
      if (e.type === 'turnStart' && game) {
        const n = cardsInGame(game.state);
        if (n !== DECK_SIZE) problems.push(`turn ${game.state.turnCount}: ${n} cards instead of ${DECK_SIZE}`);
        if (game.state.turnCount > 3000) throw new Error('game did not finish');
      }
    },
  });
  await game.start();
  return { state: game.state, events, problems };
}

function settingsFor(players: number, ending: Ending, endingTimes: 1 | 2, diffs: Difficulty[]): GameSettings {
  return {
    players, bots: players, difficulties: Array.from({ length: players }, (_, i) => diffs[i % diffs.length]!),
    names: [], ending, endingTimes, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [],
  };
}

describe('bots-only games', () => {
  const cases: [number, Ending, 1 | 2, Difficulty[]][] = [];
  for (const players of [2, 3, 4, 6])
    for (const ending of [1, 2, 3, 4] as Ending[])
      for (const times of [1, 2] as const)
        cases.push([players, ending, times, players % 2 ? ['easy', 'hard'] : ['medium', 'hard', 'easy']]);

  it.each(cases)('%i players, ending %i ×%i (%j) finish with every card accounted for', async (players, ending, times, diffs) => {
    for (const seed of [1, 2, 3]) {
      const { state, events, problems } = await play(settingsFor(players, ending, times, diffs), seed * 7919 + players);
      expect(problems).toEqual([]);
      expect(state.over, `seed ${seed}`).not.toBeNull();
      expect(state.over!.winners.length).toBeGreaterThan(0);
      expect(cardsInGame(state)).toBe(DECK_SIZE);
      expect(events.at(-1)?.type).toBe('gameOver');
    }
  });

  it('the same seed plays the same game', async () => {
    const s = settingsFor(4, 3, 1, ['hard', 'medium']);
    const a = await play(s, 42), b = await play(s, 42);
    expect(a.events.map(e => e.text)).toEqual(b.events.map(e => e.text));
    expect(a.state).toEqual(b.state);
  });

  it('a whole game survives a JSON round trip of its state', async () => {
    const { state } = await play(settingsFor(3, 1, 1, ['easy', 'medium', 'hard']), 5);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
