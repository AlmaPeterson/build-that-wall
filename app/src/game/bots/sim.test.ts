import { describe, expect, it } from 'vitest';
import { simulate, winRate } from './sim';
import { LEARNED, STARTING_STRATEGY } from './strategy';

describe("the bots' simulator", () => {
  it('plays a whole game with no people and names the winner, the same way every time', async () => {
    const a = await simulate(['easy', 'medium', LEARNED], 42);
    expect(a.length).toBeGreaterThan(0);
    expect(await simulate(['easy', 'medium', LEARNED], 42)).toEqual(a);
  });

  it('the learned strategy has every number it needs', () => {
    expect(Object.keys(LEARNED).sort()).toEqual(Object.keys(STARTING_STRATEGY).sort());
    expect(LEARNED.build).toHaveLength(3);
  });

  it('Easy bots lose clearly to Medium bots', async () => {
    expect(await winRate('easy', ['medium'], 30, 2000)).toBeLessThan(0.35);
  }, 60000);
});
