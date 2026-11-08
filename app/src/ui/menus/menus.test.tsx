// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserStorage, MemoryStorage, SaveStore } from '../../services/storage';
import { App } from '../app';
import { controller, DEFAULT_UI_SETTINGS, screen, settings } from '../app-state';
import { MenuScreen } from '../screens/Menu';
import { SettingsScreen } from '../screens/Settings';
import { GameController } from '../controller';
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
    expect(s.game.difficulties.slice(0, 3)).toEqual(['hard', 'random', 'medium']);   // a bot slot with nothing saved takes the default level
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

  it('player 1 gets your name as it is when the game starts, so a changed name shows in the next game', () => {
    const store = new SaveStore(browserStorage());
    store.set('name', 'Grandma Sue');
    expect(gameSettingsFor(3, 2).names[0]).toBe('Grandma Sue');
    store.set('name', 'Aunt Bea');                                    // changed on the Account screen
    expect(gameSettingsFor(3, 2).names[0]).toBe('Aunt Bea');
    expect(loadUiSettings(store, DEFAULT_UI_SETTINGS).game.names[0] ?? '').toBe('');   // not frozen into the settings
    const typed = { ...DEFAULT_UI_SETTINGS.game, names: ['Sue at the table'] };   // a name typed in Settings wins
    expect(gameSettingsFor(3, 2, typed).names[0]).toBe('Sue at the table');
    expect(gameSettingsFor(3, 3).names[0] ?? '').toBe('');              // watch mode: no Player 1
  });

  it('Settings only has how the app looks and sounds; game choices are asked at Play', () => {
    act(() => { render(<SettingsScreen />, root); });
    const labels = [...root.querySelectorAll('.settings__label')].map(l => l.textContent);
    expect(labels).toContain('Sound Effects');
    expect(labels).not.toContain('Players');
    expect(labels).not.toContain('Ending');
    expect(root.querySelector('input[type="text"]')).toBeNull();
  });

  it('saves what was picked in the Play box for next time', () => {
    const store = fresh();
    initSettingsPersistence(store);
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click('Play with bots');
    const bots = settings.get().game.bots;
    act(() => { (root.querySelector('[aria-label="Bots more"]') as HTMLButtonElement).click(); });
    expect(settings.get().game).toMatchObject({ bots: bots + 1, players: bots + 2 });
    expect(store.prefGet('ai')).toBe(String(bots + 1));
  });

  it('saves changes made during a game too, and says so', () => {
    const store = fresh();
    initSettingsPersistence(store);
    controller.set(new GameController());
    act(() => { render(<SettingsScreen />, root); });
    expect(root.querySelector('.page__foot')?.textContent).toContain('Changes are saved as you make them');
    expect([...root.querySelectorAll('.page__foot button')].map(b => b.textContent)).toEqual(['Done']);
    act(() => { (root.querySelector('[aria-label="Sound Effects"]') as HTMLButtonElement).click(); });
    expect(store.prefGet('sound')).toBe('0');
    expect(root.querySelector('.settings__saved')?.textContent).toBe('✓ Saved');
    controller.set(null);
  });

  it('how the game ends is under More options, and Ending Times only shows when the deck can end it', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click('Play with bots');
    expect(root.querySelector('#play-ending')).toBeNull();
    act(() => { root.querySelector<HTMLButtonElement>('.play__more')!.click(); });
    expect(root.querySelector('#play-ending')).not.toBeNull();
    expect(root.querySelector('#play-times')).toBeNull();
    act(() => { settings.set({ ...settings.get(), game: { ...settings.get().game, ending: 2 } }); });
    expect(root.querySelector('#play-times')).not.toBeNull();
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

  it('Play with bots: pick how many and how hard, then Start (no sign-in needed)', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click('Play with bots');
    act(() => { (root.querySelector('[aria-label="Bots more"]') as HTMLButtonElement).click(); });
    const bots = settings.get().game.bots;
    click('Hard');
    click('Start');
    expect(screen.get()).toBe('game');
    expect(game().seats.filter(s => s.bot).map(s => s.bot)).toEqual(Array(bots).fill('hard'));
    expect(game().seats[0]!.bot).toBeNull();
  });

  it('bots can be set one by one', () => {
    settings.set(clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players: 3, bots: 2, difficulties: Array(6).fill('easy') } }));
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click('Play with bots');
    expect(root.querySelector('[aria-label="Bot difficulty"] .is-current')?.textContent).toBe('Easy');
    click('Set each bot separately');
    const second = root.querySelector<HTMLSelectElement>('#play-ai2')!;
    act(() => { second.value = 'medium'; second.dispatchEvent(new Event('change', { bubbles: true })); });
    click('Start');
    expect(game().seats.map(s => s.bot)).toEqual([null, 'easy', 'medium']);
  });

  it('bots that differ open one by one', () => {
    settings.set(clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players: 3, bots: 2, difficulties: ['hard', 'easy'] } }));
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click('Play with bots');
    expect(root.querySelector('#play-ai1')).not.toBeNull();
    click('Same for every bot');
    expect(root.querySelector('[aria-label="Bot difficulty"] .is-current')?.textContent).toBe('Hard');
  });

  it("Pass'n'Play: how many people and bots, then everyone's names", () => {
    settings.set(clampSettings({ ...DEFAULT_UI_SETTINGS, game: { ...DEFAULT_UI_SETTINGS.game, players: 3, bots: 1 } }));
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click("Pass'n'Play");
    expect(root.querySelector('[aria-label="People"] output')?.textContent).toBe('2');
    click('Next');
    expect(screen.get()).toBe('menu');
    const inputs = [...root.querySelectorAll<HTMLInputElement>('.names input')];
    expect(inputs).toHaveLength(2);
    act(() => {
      inputs.forEach((input, k) => { input.value = ['Alma', 'Sam'][k]!; input.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    act(() => { root.querySelector<HTMLButtonElement>('.names button[type="submit"]')!.click(); });
    expect(screen.get()).toBe('game');
    expect(game().seats.map(s => s.name).slice(0, 2)).toEqual(['Alma', 'Sam']);
    expect(settings.get().game.names.slice(0, 2)).toEqual(['Alma', 'Sam']);
  });

  it('Play online goes to the online screen; Back returns to the choices', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Play');
    click("Pass'n'Play");
    click('Back');
    click('Play online');
    expect(screen.get()).toBe('online');
  });

  it('your name is on the home page and can be changed there', () => {
    act(() => { render(<MenuScreen />, root); });
    act(() => { root.querySelector<HTMLButtonElement>('.menu__name')!.click(); });
    const input = root.querySelector<HTMLInputElement>('#menu-name')!;
    act(() => { input.value = 'Grandma Sue'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { root.querySelector<HTMLFormElement>('.menu__name-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    return vi.waitFor(() => {
      expect(root.querySelector('.menu__name')?.textContent).toContain('Grandma Sue');
      expect(new SaveStore(browserStorage()).get('name')).toBe('Grandma Sue');
    });
  });

  it('menu buttons go to their screens', () => {
    act(() => { render(<MenuScreen />, root); });
    click('Account & Store');
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
