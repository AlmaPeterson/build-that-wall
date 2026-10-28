// Settings are saved in "btw:prefs" with the old game's names and values, so players who move to the
// new version keep their settings (docs/game-rules.md section 2, Panels › when green flag clicked).
import type { Difficulty, Ending } from '../../game';
import { browserStorage, SaveStore } from '../../services/storage';
import { settings, type TextArea, type UiSettings } from '../app-state';

export type BotLevel = Difficulty | 'random';

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

export const ENDING_NAMES: Record<Ending, string> = {
  1: '3 Sets of 3 Walls',
  2: 'Exhaust Deck',
  3: 'Whatever Happens First',
  4: 'Whatever Happens Last',
};

const LEVEL_TO_OLD: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', random: 'Random' };
const OLD_TO_LEVEL: Record<string, BotLevel> = { Easy: 'easy', Medium: 'medium', Hard: 'hard', Random: 'random' };

/** Text size areas and the old game's pref keys ("ts_<key>"). Popups, cards in hand and the board match
 *  old categories one to one; "menu" uses the old "Windows and guides" size. */
export const TEXT_PREF: Record<TextArea, string> = { menu: 'win', board: 'board', cards: 'hand', popups: 'pop' };

/** The size choices per area (same steps as the old Text Size window). */
export const TEXT_STEPS: Record<TextArea, { value: number; name: string }[]> = {
  popups: [{ value: 0.85, name: 'Small' }, { value: 1, name: 'Normal' }, { value: 1.15, name: 'Large' }, { value: 1.3, name: 'Extra large' }],
  board: [{ value: 0.9, name: 'Small' }, { value: 1, name: 'Normal' }, { value: 1.1, name: 'Large' }, { value: 1.2, name: 'Extra large' }],
  cards: [{ value: 1, name: 'Normal' }, { value: 1.1, name: 'Large' }],
  menu: [{ value: 0.85, name: 'Small' }, { value: 1, name: 'Normal' }],
};

/** Every bot slot has a level, even bots not in use (the old game kept 6: Easy ×5, then Medium). */
export const DEFAULT_LEVELS: BotLevel[] = ['easy', 'easy', 'easy', 'easy', 'easy', 'medium'];

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Keep settings legal, as the old game does: 2-6 players (else 6), bots ≤ players, Ending Times 1-2. */
export function clampSettings(s: UiSettings): UiSettings {
  const g = s.game;
  const players = Number.isFinite(g.players) && g.players >= MIN_PLAYERS && g.players <= MAX_PLAYERS ? Math.round(g.players) : MAX_PLAYERS;
  const bots = clampInt(Number.isFinite(g.bots) ? g.bots : 0, 0, players);
  const levels = Array.from({ length: MAX_PLAYERS }, (_, k) => g.difficulties[k] ?? DEFAULT_LEVELS[k]!);
  const ending = ([1, 2, 3, 4] as const).includes(g.ending) ? g.ending : 1;
  const endingTimes = g.endingTimes === 2 ? 2 : 1;
  const names = Array.from({ length: MAX_PLAYERS }, (_, k) => String(g.names[k] ?? '').slice(0, 20));
  const textSizes = { ...s.textSizes };
  for (const area of Object.keys(TEXT_STEPS) as TextArea[]) {
    const v = Number(textSizes[area]);
    textSizes[area] = v > 0 ? v : 1;
  }
  return { ...s, game: { ...g, players, bots, difficulties: levels, ending, endingTimes, names }, textSizes };
}

/** Read the saved settings over `base`. Missing or broken values keep `base`'s. */
export function loadUiSettings(store: SaveStore, base: UiSettings): UiSettings {
  const get = (k: string) => store.prefGet(k);
  const num = (k: string, d: number) => { const v = get(k); return v === '' || !Number.isFinite(+v) ? d : +v; };
  const g = base.game;
  const levels = Array.from({ length: MAX_PLAYERS }, (_, k) => OLD_TO_LEVEL[get('ai' + (k + 1))] ?? g.difficulties[k] ?? DEFAULT_LEVELS[k]!);
  const textSizes = { ...base.textSizes };
  for (const area of Object.keys(TEXT_PREF) as TextArea[]) textSizes[area] = num('ts_' + TEXT_PREF[area], textSizes[area]);
  const names = [...g.names];
  const myName = store.get('name');
  if (myName && !names[0]) names[0] = myName;
  const mode = get('mode'), music = get('music');
  return clampSettings({
    ...base,
    game: {
      ...g,
      players: num('players', g.players),
      bots: num('ai', g.bots),
      ending: num('ending', g.ending) as Ending,
      endingTimes: num('times', g.endingTimes) as 1 | 2,
      difficulties: levels,
      names,
    },
    gameMode: mode === 'Multiplayer' ? 'multiplayer' : mode === "Pass'n'Play" ? 'passnplay' : base.gameMode,
    sound: get('sound') === '' ? base.sound : get('sound') !== '0',
    musicMode: music === 'Play One' ? 'one' : music === 'Cycle All' ? 'cycle' : base.musicMode,
    autoJoin: get('autojoin') === '' ? base.autoJoin : get('autojoin') === '1',
    tutorial: get('tutor') === '' ? base.tutorial : get('tutor') === '1',
    animSpeed: (['slow', 'normal', 'fast', 'off'] as const).find(a => a === get('anim')) ?? base.animSpeed,
    textSizes,
  });
}

/** Save settings with the old names. Only changed values are written, like the old game. */
export function saveUiSettings(store: SaveStore, s: UiSettings): void {
  const put = (k: string, v: string) => { if (store.prefGet(k) !== v) store.prefSet(k, v); };
  const g = s.game;
  put('players', String(g.players));
  put('ai', String(g.bots));
  put('ending', String(g.ending));
  put('times', String(g.endingTimes));
  put('sound', s.sound ? '1' : '0');
  put('mode', s.gameMode === 'multiplayer' ? 'Multiplayer' : "Pass'n'Play");
  put('music', s.musicMode === 'one' ? 'Play One' : 'Cycle All');
  put('autojoin', s.autoJoin ? '1' : '0');
  g.difficulties.slice(0, MAX_PLAYERS).forEach((d, k) => put('ai' + (k + 1), LEVEL_TO_OLD[d]));
  put('tutor', s.tutorial ? '1' : '0');
  put('anim', s.animSpeed);
  for (const area of Object.keys(TEXT_PREF) as TextArea[]) put('ts_' + TEXT_PREF[area], String(s.textSizes[area]));
}

let started = false;
let stop: (() => void) | null = null;

/**
 * Load saved settings into the settings store once, then save every change straight away. (The old game
 * only saved between games, so changes made during a game could be lost; the running game keeps its own
 * copy of the game settings, so saving them mid-game is safe.) Safe to call many times.
 */
export function initSettingsPersistence(store: SaveStore = new SaveStore(browserStorage())): void {
  if (started) return;
  started = true;
  settings.set(loadUiSettings(store, settings.get()));
  stop = settings.subscribe(s => saveUiSettings(store, s));
}

/** For tests: forget that persistence was started. */
export function resetSettingsPersistenceForTests(): void { stop?.(); stop = null; started = false; }

/** Change settings through the clamp. */
export function updateSettings(fn: (s: UiSettings) => UiSettings): void {
  settings.set(clampSettings(fn(settings.get())));
}
