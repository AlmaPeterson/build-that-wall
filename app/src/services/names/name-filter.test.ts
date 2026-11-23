import { describe, expect, it } from 'vitest';
import { nameIsOk } from './name-filter';

// Built from pieces so the test file itself doesn't spell them out
const N = 'ni' + 'gg', F = 'fu' + 'ck';

describe('player names', () => {
  it('allows ordinary names, including ones that only look like a rude word inside', () => {
    for (const ok of ['Alma', 'Louis', 'Andrew', 'Player 2', 'Nigel', 'Dickens', 'Hancock', 'Raccoon', 'Spicer', 'Cockburn', 'Sussex', 'Torpedo', 'Grape', 'Bot Max', 'Trump Fan 2024', 'Ann-Marie'])
      expect(nameIsOk(ok), ok).toBe(true);
  });

  it('stops slurs, swearing and hate, however they are written', () => {
    for (const bad of [N + 'er', 'Big' + N.replace(/^n/, 'N') + 'a', 'n1gg3r', 'N i g g e r', F, 'F.U.C.K', F.toUpperCase() + 'ER', 'sh!t head', 'Bull' + 'shit', 'Dick', 'ass', 'Heil Hitler', 'xX1488Xx', 'kike', 'Fa' + 'ggot'])
      expect(nameIsOk(bad), bad).toBe(false);
  });
});

describe('where names are used', () => {
  it('online and in games a rude name becomes empty, so "Player 2" shows instead', async () => {
    const { cleanName } = await import('../online/room');
    expect(cleanName('  Alma ')).toBe('Alma');
    expect(cleanName(N + 'a')).toBe('');
  });

  it('the leaderboard leaves rude names out', async () => {
    const { topTen } = await import('../leaderboard/leaderboard');
    const row = (name: string, best: number) => ({ name, games: 1, wins: 0, best, walls: 1, spent: 0 });
    expect(topTen([row('Alma', 10), row(N + 'er', 99)], 'miles')).toEqual(['1.  Alma   10 miles']);
  });
});
