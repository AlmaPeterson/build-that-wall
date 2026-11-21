// The Insane bot: fair practice games (it never sees hidden cards) and whole games that finish.
import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/setup';
import { createLocalGame } from '../local';
import { guessState, score } from './insane';

const settings = { players: 3, bots: 3, difficulties: ['insane', 'hard', 'medium'] as const, names: [], ending: 1 as const, endingTimes: 1 as const, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] };

describe('Insane bot', () => {
  it("practice games keep its own hand and the walls, and shuffle the cards it can't see", () => {
    const s = createGame({ ...settings, difficulties: [...settings.difficulties] }, 21);
    s.seats.forEach((seat, i) => { seat.hand = s.draw.splice(0, 5); seat.walls = i === 1 ? [29, 29] : []; });
    let x = 1;
    const g = guessState(s, 0, () => ((x = (x * 16807) % 2147483647) / 2147483647));
    expect(g.seats[0]!.hand).toEqual(s.seats[0]!.hand);
    expect(g.seats[1]!.walls).toEqual([29, 29]);
    expect(g.seats.map(p => p.hand.length)).toEqual(s.seats.map(p => p.hand.length));
    const hidden = (st: typeof s) => [...st.draw, ...st.seats[1]!.hand, ...st.seats[2]!.hand].sort((a, b) => a - b);
    expect(hidden(g)).toEqual(hidden(s));                  // the same cards, shuffled
    expect(g.seats[1]!.hand).not.toEqual(s.seats[1]!.hand);
    expect(g.seats.every(p => p.bot === 'hard')).toBe(true);
  });

  it('scores being ahead, and a win most of all', () => {
    const s = createGame({ ...settings, difficulties: [...settings.difficulties] }, 2);
    s.seats[0]!.walls = [29, 29, 29]; s.seats[1]!.walls = [30];
    expect(score(s, 0)).toBe(16 - 3);
    s.over = { winners: [0], miles: [16, 3, 0], reason: '' };
    expect(score(s, 0)).toBeGreaterThan(1000);
  });

  it('a game with an Insane bot finishes', async () => {
    const g = createLocalGame({ settings: { ...settings, players: 2, bots: 2, difficulties: ['insane', 'easy'] }, seed: 31 });
    await g.start();
    expect(g.state.over).not.toBeNull();
  }, 120_000);
});
