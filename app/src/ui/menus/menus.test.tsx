// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, SaveStore } from '../../services/storage';
import { App } from '../app';
import { controller, DEFAULT_UI_SETTINGS, screen, settings } from '../app-state';
import { MenuScreen } from '../screens/Menu';
import { SettingsScreen } from '../screens/Settings';
import {
  clampSettings, initSettingsPersistence, loadUiSettings, resetSettingsPersistenceForTests, saveUiSettings,
} from './prefs';
import { gameSettingsFor, onlineIntent, startPassNPlay, startVsBots, startWatch } from './start';

const fresh = () => new SaveStore(new MemoryStorage());

function oldPrefs(values: Record<string, string>): SaveStore {
  const store = fresh();
  store.set('prefs', JSON.stringify(values));
  return store;
}

let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));   // no game-settings.json
  resetSettingsPersistenceForTests();
  settings.set(DEFAULT_UI_SETTINGS);
  screen.set('menu');
  controller.set(null);
  onlineIntent.set(null);
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetSettingsPersistenceForTests();
  vi.unstubAllGlobals();
});

const click = (label: string) => {
  const b = [...root.querySelectorAll('button')].find(x => x.textContent?.trim() === label);
  if (!b) throw new Error('No button ' + label);
  act(() => { b.click(); });
};

describe('settings', () => {
  it('loads settings saved by the old game', () => {
    const s = loadUiSettings(oldPrefs({
      players: '4', ai: '2', ending: '3', times: '2', sound: '0', mode: 'Multiplayer', music: 'Play One',
      autojoin: '1', ai1: 'Hard', ai2: 'Random', tutor: '1', ts_pop: '1.3', ts_board: '0.9', ts_hand: '1.1', ts_win: '0.85',
    }), DEFAULT_UI_SETTINGS);
    expect(s.game).toMatchObject({ players: 4, bots: 2, ending: 3, endingTimes: 2 });
    expect(s.game.difficulties.slice(0, 3)).toEqual(['hard', 'random', 'easy']);
    expect(s).toMatchObject({ sound: false, gameMode: 'multiplayer', musicMode: 'one', autoJoin: true, tutorial: true });
    expect(s.textSizes).toEqual({ popups: 1.3, board: 0.9, cards: 1.1, menu: 0.85 });
  });

  it('saves with the old names and values, and reads back the same', () => {
    const store = fresh();
    const s = clampSettings({ ...DEFAULT_UI_SETTINGS, gameMode: 'multiplayer', sound: false,
      game: { ...DEFAULT_UI_SETTINGS.game, players: 5, bots: 3, ending: 4, endingTimes: 2, difficulties: ['hard', 'medium', 'random'] } });
    saveUiSettings(store, s);
    expect(store.getJson('prefs', {})).toMatchObject({
      players: '5', ai: '3', ending: '4', times: '2', sound: '0', mode: 'Multiplayer', music: 'Cycle All',
      ai1: 'Hard', ai2: 'Medium', ai3: 'Random', ai4: 'Easy', ai6: 'Medium', ts_pop: '1',
    });
    expect(loadUiSettings(store, DEFAULT_UI_SETTINGS)).toEqual(s);
  });

  it('keeps settings legal like the old game', () => {
    const c = (players: number, bots: number) => clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players, bots } }).game;
    expect(c(9, 1).players).toBe(6);       // outside 2-6 resets to 6
    expect(c(1, 0).players).toBe(6);
    expect(c(3, 5).bots).toBe(3);          // bots ≤ players
    expect(c(3, -2).bots).toBe(0);
    expect(c(3, 1).difficulties).toHaveLength(6);
  });

  it('ignores broken saved values', () => {
    const s = loadUiSettings(oldPrefs({ players: 'lots', ai: '', ending: '7', ai1: 'Godlike', ts_pop: '-1' }), DEFAULT_UI_SETTINGS);
    expect(s.game.players).toBe(DEFAULT_UI_SETTINGS.game.players);
    expect(s.game.ending).toBe(1);
    expect(s.game.difficulties[0]).toBe(DEFAULT_UI_SETTINGS.game.difficulties[0]);
    expect(s.textSizes.popups).toBe(1);
  });

  it('uses the saved player name for player 1', () => {
    const store = fresh();
    store.set('name', 'Grandma Sue');
    expect(loadUiSettings(store, DEFAULT_UI_SETTINGS).game.names[0]).toBe('Grandma Sue');
  });

  it('saves changes made on the Settings screen', () => {
    const store = fresh();
    initSettingsPersistence(store);
    act(() => { render(<SettingsScreen />, root); });
    act(() => { (root.querySelector('[aria-label="Players more"]') as HTMLButtonElement).click(); });
    expect(settings.get().game.players).toBe(DEFAULT_UI_SETTINGS.game.players + 1);
    expect(store.prefGet('players')).toBe(String(DEFAULT_UI_SETTINGS.game.players + 1));
  });

  it('hides Ending Times when the game ends on 3 sets', () => {
    act(() => { render(<SettingsScreen />, root); });
    expect(root.querySelector('#set-times')).toBeNull();
    act(() => { settings.set({ ...settings.get(), game: { ...settings.get().game, ending: 2 } }); });
    expect(root.querySelector('#set-times')).not.toBeNull();
  });
});

describe('text sizes', () => {
  it('become CSS variables on the app', () => {
    settings.set({ ...DEFAULT_UI_SETTINGS, textSizes: { menu: 0.85, board: 1.2, cards: 1.1, popups: 1.3 } });
    act(() => { render(<App />, root); });
    const app = root.querySelector('.app') as HTMLElement;
    expect(app.style.getPropertyValue('--text-popups')).toBe('1.3');
    expect(app.style.getPropertyValue('--text-board')).toBe('1.2');
  });

  it('change when a size is picked on the Settings screen', () => {
    act(() => { render(<SettingsScreen />, root); });
    const group = root.querySelector('[aria-label="Messages and choice lists"]')!;
    act(() => { ([...group.querySelectorAll('button')].find(b => b.textContent === 'Large') as HTMLButtonElement).click(); });
    expect(settings.get().textSizes.popups).toBe(1.15);
  });
});

describe('starting games', () => {
  const game = () => controller.get()!.state!;

  it("Pass'n'Play uses the settings' players and bots", () => {
    settings.set(clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players: 4, bots: 2, difficulties: ['hard', 'easy', 'medium'] } }));
    startPassNPlay();
    expect(screen.get()).toBe('game');
    expect(game().seats.map(s => s.bot)).toEqual([null, null, 'hard', 'easy']);
  });

  it('against bots: you and Players - 1 bots; watch: bots only', () => {
    settings.set(clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players: 3, bots: 0 } }));
    startVsBots();
    expect(game().seats.filter(s => s.bot).length).toBe(2);
    startWatch();
    expect(game().seats.every(s => s.bot)).toBe(true);
  });

  it('only sends the engine one difficulty per bot', () => {
    const g = gameSettingsFor(3, 1, { ...DEFAULT_UI_SETTINGS.game, difficulties: ['hard', 'easy', 'easy', 'easy', 'easy', 'medium'] });
    expect(g.difficulties).toEqual(['hard']);
  });

  it('Start Game in Pass\'n\'Play starts a game without signing in', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Start Game');
    expect(screen.get()).toBe('game');
    expect(controller.get()).not.toBeNull();
  });

  it('Start Game in Multiplayer opens the online choices', () => {
    settings.set({ ...DEFAULT_UI_SETTINGS, gameMode: 'multiplayer' });
    act(() => { render(<MenuScreen />, root); });
    click('Start Game');
    click('Join with a code');
    expect(onlineIntent.get()).toBe('join');
    expect(screen.get()).toBe('online');
  });

  it('menu buttons go to their screens', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Gold Membership');
    expect(screen.get()).toBe('account');
    click('Settings');
    expect(screen.get()).toBe('settings');
    click('Instructions');
    expect(screen.get()).toBe('instructions');
  });

  it('Tutorial opens the guide; its last page starts a tutorial game', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Tutorial');
    expect(root.querySelector('.guide')).not.toBeNull();
    const nav = [...root.querySelectorAll('.guide__nav button')];
    act(() => { (nav.at(-1) as HTMLButtonElement).click(); });
    click('Start a tutorial game');
    expect(settings.get().tutorial).toBe(true);
    expect(screen.get()).toBe('game');
  });
});
