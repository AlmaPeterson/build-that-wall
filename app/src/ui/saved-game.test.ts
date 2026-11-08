// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { browserStorage, SaveStore } from '../services/storage';
import { controller, DEFAULT_UI_SETTINGS, screen, startLocalGame } from './app-state';
import { loadSavedGame, resumeSavedGame } from './saved-game';

const store = () => new SaveStore(browserStorage());
const tick = () => new Promise(r => setTimeout(r, 0));

describe('saved games', () => {
  beforeEach(() => { controller.get()?.stop(); controller.set(null); localStorage.clear(); screen.set('menu'); });

  it('a game on this device saves itself, comes back after a reload, and is forgotten on End Game', async () => {
    startLocalGame({ ...DEFAULT_UI_SETTINGS.game, players: 2, bots: 1, firstSeat: 0 });
    for (let i = 0; i < 20 && !loadSavedGame(); i++) await tick();
    const saved = loadSavedGame()!;
    expect(saved.state.seats).toHaveLength(2);

    // "Reload": nothing running, then the page starts again
    controller.get()!.stop();
    controller.set(null);
    expect(loadSavedGame()).toBeNull();                       // dropping the game forgets it...
    store().setJson('game', saved);                           // (as if the page had closed instead)
    screen.set('menu');
    expect(resumeSavedGame()).toBe(true);
    expect(screen.get()).toBe('game');
    expect(controller.get()!.state!.seats[0]!.hand).toEqual(saved.state.seats[0]!.hand);

    // End Game
    controller.get()!.stop();
    controller.set(null);
    expect(store().get('game')).toBe('');
  });

  it('nothing to carry on: stays on the menu; old or broken saves are ignored', () => {
    expect(resumeSavedGame()).toBe(false);
    store().set('game', '{broken');
    expect(loadSavedGame()).toBeNull();
    store().setJson('game', { v: 1, state: { seats: [{}] }, events: [], at: 'turn', savedAt: Date.now() - 30 * 86400000 });
    expect(loadSavedGame()).toBeNull();
    expect(screen.get()).toBe('menu');
  });
});
