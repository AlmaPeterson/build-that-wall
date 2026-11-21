// Stats, bot names, replays, tip reasons and the leaderboard star.
import { describe, expect, it } from 'vitest';
import { createGame, type GameEvent } from '../game';
import { topTen } from '../services/leaderboard/leaderboard';
import { cardsPlayed, hardestBot, summarize, type GameLine } from '../services/stats/stats';
import { whyText } from './overlays/text';
import { shrink, type Replay } from './replay';

const line = (won: boolean, miles: number, extra: Partial<GameLine> = {}): GameLine =>
  ({ t: 1, mode: 'bots', diff: 'hard', won, miles, walls: 3, players: 2, plays: {}, ...extra });

describe('detailed stats', () => {
  it('win rates by mode and level, best game, favourite card and streaks', () => {
    const s = summarize([
      line(true, 40, { plays: { 7: 2 } }), line(false, 20, { mode: 'online', diff: '' }),
      line(true, 55, { diff: 'insane', plays: { 7: 1, 26: 4 } }), line(true, 30),
    ]);
    expect(s.games).toBe(4);
    expect(s.wins).toBe(3);
    expect(s.byMode.bots).toEqual({ games: 3, wins: 3 });
    expect(s.byMode.online).toEqual({ games: 1, wins: 0 });
    expect(s.byDiff.insane).toEqual({ games: 1, wins: 1 });
    expect(s.best!.miles).toBe(55);
    expect(s.favourite).toEqual({ card: 26, times: 4 });
    expect(s.streak).toBe(2);
    expect(s.bestStreak).toBe(2);
    expect(s.avgMiles).toBe(36);
  });

  it('counts the cards one seat played, and finds the hardest bot', () => {
    const ev = [{ type: 'play', seat: 0, card: 7 }, { type: 'play', seat: 1, card: 7 }, { type: 'play', seat: 0, card: 7 }] as GameEvent[];
    expect(cardsPlayed(ev, 0)).toEqual({ 7: 2 });
    const st = createGame({ players: 3, bots: 2, difficulties: ['easy', 'insane'], names: [], ending: 1, endingTimes: 1, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 1);
    expect(hardestBot(st)).toBe('insane');
  });
});

describe('leaderboard', () => {
  it('Gold members have a star by their name', () => {
    expect(topTen([{ name: 'Ann', games: 1, wins: 1, best: 9, walls: 1, gold: true }, { name: 'Bo', games: 1, wins: 0, best: 3, walls: 1 }], 'miles'))
      .toEqual(['1.  ★ Ann   9 miles', '2.  Bo   3 miles']);
  });
});

describe('replays', () => {
  it('a replay too big to keep loses every other picture, keeping the first and last', () => {
    const frame = (n: number) => ({ view: { pad: 'x'.repeat(100) } as never, n });
    const r: Replay = { v: 1, viewer: 0, frames: Array.from({ length: 9 }, (_, i) => frame(i)), events: [], savedAt: 0 };
    const small = shrink(r, 700)!;
    expect(small.frames.length).toBeLessThan(9);
    expect(small.frames[0]!.n).toBe(0);
    expect(small.frames.at(-1)!.n).toBe(8);
    expect(shrink(r, 10)).toBeNull();
  });
});

describe('tutorial tips say why', () => {
  const state = { actionsLeft: 3, seats: [
    { name: 'You', hand: [29, 14, 7], walls: [29, 29], left: false },
    { name: 'Bo', hand: [], walls: [30, 30, 31], left: false },
  ] } as never;
  it('finishing a set, making a pair, Debt on the leader, ending the turn', () => {
    expect(whyText({ type: 'build', slot: 0, pay: { manHour: 1 } }, state, 0)).toMatch(/finishes a set of 3/);
    expect(whyText({ type: 'play', slot: 2 }, state, 0)).toMatch(/Bo is ahead with 11 miles/);
    expect(whyText({ type: 'endTurn' }, { ...(state as object), actionsLeft: 0 } as never, 0)).toMatch(/used all your actions/);
  });
});

describe('typed numbers for the endings', () => {
  it('are kept in range, and the endings are named with them', async () => {
    const { clampNumber, endingName, MILES_RANGE } = await import('./menus/prefs');
    expect(clampNumber('75', MILES_RANGE, 50)).toBe(75);
    expect(clampNumber('2', MILES_RANGE, 50)).toBe(5);
    expect(clampNumber('', MILES_RANGE, 50)).toBe(50);
    expect(clampNumber('abc', MILES_RANGE, 50)).toBe(50);
    expect(endingName(5, { miles: 75 })).toBe('First to 75 Miles');
    expect(endingName(6, { minutes: 1 })).toBe('Ends in 1 Minute');
    expect(endingName(1, {})).toBe('3 Sets of 3 Walls');
  });
});
