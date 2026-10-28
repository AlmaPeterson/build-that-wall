import { describe, expect, it } from 'vitest';
import { baseDeck } from '../../data/cards';
import { DEFAULT_SETTINGS } from '../types';
import { createGame } from './setup';

const count = (a: number[]) => a.reduce<Record<number, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});

describe('createGame', () => {
  it('builds the 107-card base deck, shuffled', () => {
    const s = createGame({ ...DEFAULT_SETTINGS }, 42);
    expect(s.draw).toHaveLength(107);
    expect(count(s.draw)).toEqual(count(baseDeck()));
    expect(s.draw).not.toEqual(baseDeck());
  });

  it('adds active pack cards to the deck', () => {
    const s = createGame({ ...DEFAULT_SETTINGS, packCards: [45, 46] }, 1);
    expect(s.draw).toHaveLength(109);
    expect(s.draw).toContain(45);
  });

  it('is the same game for the same seed', () => {
    expect(createGame({ ...DEFAULT_SETTINGS }, 7).draw).toEqual(createGame({ ...DEFAULT_SETTINGS }, 7).draw);
    expect(createGame({ ...DEFAULT_SETTINGS }, 7).draw).not.toEqual(createGame({ ...DEFAULT_SETTINGS }, 8).draw);
  });

  it('puts bots in the last seats and names everyone', () => {
    const s = createGame({ ...DEFAULT_SETTINGS, players: 4, bots: 2, difficulties: ['hard'], names: ['Ann'] }, 1);
    expect(s.seats.map(p => p.bot)).toEqual([null, null, 'hard', 'easy']);   // bot 2 defaults to Easy
    expect(s.seats.map(p => p.name)).toEqual(['Ann', 'Player 2', 'Bot Liberty', 'Bot Eagle']);
  });

  it('the 6th bot defaults to Medium', () => {
    const s = createGame({ ...DEFAULT_SETTINGS, players: 6, bots: 6, difficulties: [] }, 1);
    expect(s.seats.map(p => p.bot)).toEqual(['easy', 'easy', 'easy', 'easy', 'easy', 'medium']);
  });

  it('resolves random difficulties from the seed', () => {
    const levels = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const s = createGame({ ...DEFAULT_SETTINGS, players: 2, bots: 1, difficulties: ['random'] }, seed);
      levels.add(s.seats[1]!.bot!);
    }
    expect([...levels].sort()).toEqual(['easy', 'hard', 'medium']);
  });

  it('fixes out-of-range players and bots', () => {
    const s = createGame({ ...DEFAULT_SETTINGS, players: 9, bots: 12 }, 1);
    expect(s.settings.players).toBe(6);
    expect(s.settings.bots).toBe(6);
    expect(s.seats).toHaveLength(6);
  });
});
