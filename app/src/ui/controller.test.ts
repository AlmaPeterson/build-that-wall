import { describe, expect, it } from 'vitest';
import { GameController } from './controller';

const settings = (players: number, bots: number) => ({
  players, bots, difficulties: Array(bots).fill('medium'), names: [], ending: 1 as const, endingTimes: 1 as const,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [],
});

describe('GameController', () => {
  it('a bots-only game runs to the end and publishes the result', async () => {
    const c = new GameController();
    await c.start(settings(3, 3), 11);
    const snap = c.snapshot.get();
    expect(snap.view?.over).not.toBeNull();
    expect(snap.events.at(-1)?.type).toBe('gameOver');
  });

  it("shows only the viewer's hand and waits for the human to act", async () => {
    const c = new GameController();
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    const snap = c.snapshot.get();
    expect(snap.view).not.toBeNull();
    expect(snap.viewer).toBe(0);
    expect(snap.view!.seats[1]!.hand.every(id => id === 4)).toBe(true);   // the bot's hand is hidden
    if (snap.view!.turn === 0 && !snap.prompt) {
      expect((await c.act({ type: 'endTurn' })).ok).toBe(true);
    }
  });

  it('shows the pass-the-device screen between two humans', async () => {
    const c = new GameController({ passScreen: true });
    void c.start(settings(2, 0), 5);
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().passTo).toBe(0);
    c.ready();
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().passTo).toBeNull();
  });
});
