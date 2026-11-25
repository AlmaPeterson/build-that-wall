// Settings are saved in "btw:prefs" with the old game's names and values, so players who move to the
// new version keep their settings (docs/game-rules.md section 2, Panels › when green flag clicked).
import { SONGS } from '../music/default-song';
import { DEFAULT_MINUTES, MILES_TO_WIN, type Difficulty, type Ending } from '../../game';
import { browserStorage, SaveStore } from '../../services/storage';
import { settings, type TextArea, type UiSettings } from '../app-state';

export type BotLevel = Difficulty | 'random';

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
/** The longest name a bot can have ("Bot " goes in front). */
export const BOT_NAME_MAX = 16;

export const ENDING_NAMES: Record<Ending, string> = {
  1: '3 Sets of 3 Walls',
  2: 'Exhaust Deck',
  3: 'Whatever Happens First',
  4: 'Whatever Happens Last',
  5: 'First to __ Miles',
  6: 'Ends in __ Minutes',
};

/** Every ending, in menu order. */
export const ENDINGS: Ending[] = [1, 2, 3, 4, 5, 6];
/** The numbers you can type for First to __ Miles and Ends in __ Minutes. */
export const MILES_RANGE = { min: 5, max: 999 };
export const MINUTES_RANGE = { min: 1, max: 600 };

/** A typed number kept in range; not a number = the default. */
export function clampNumber(v: unknown, r: { min: number; max: number }, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v).trim() !== '' ? Math.min(r.max, Math.max(r.min, n)) : fallback;
}

/** "First to 50 Miles", "Ends in 20 Minutes", or the ending's name. */
export function endingName(ending: Ending, g: { miles?: number; minutes?: number }): string {
  if (ending === 5) return 'First to ' + (g.miles ?? MILES_TO_WIN) + ' Miles';
  if (ending === 6) return 'Ends in ' + (g.minutes ?? DEFAULT_MINUTES) + (g.minutes === 1 ? ' Minute' : ' Minutes');
  return ENDING_NAMES[ending];
}
/** The deck running out only matters for endings 2-4. */
export const usesDeck = (e: Ending): boolean => e >= 2 && e <= 4;

const LEVEL_TO_OLD: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane', random: 'Random' };
const OLD_TO_LEVEL: Record<string, BotLevel> = { Easy: 'easy', Medium: 'medium', Hard: 'hard', Insane: 'insane', 'Extra Hard': 'insane', Random: 'random' };

/** Text size areas and the old game's pref keys ("ts_<key>"). Popups, cards in hand and the board match
 *  old categories one to one; "menu" uses the old "Windows and guides" size. */
export const TEXT_PREF: Record<TextArea, string> = { menu: 'win', board: 'board', cards: 'hand', popups: 'pop' };

/** How small and big each area's text slider goes (1 = normal). Covers every size the old Text Size window had. */
export const TEXT_RANGE: Record<TextArea, { min: number; max: number }> = {
  popups: { min: 0.8, max: 1.4 },
  board: { min: 0.8, max: 1.3 },
  cards: { min: 0.9, max: 1.25 },
  menu: { min: 0.8, max: 1.2 },
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
  const ending = ENDINGS.includes(g.ending) ? g.ending : 1;
  const minutes = clampNumber(g.minutes, MINUTES_RANGE, DEFAULT_MINUTES);
  const miles = clampNumber(g.miles, MILES_RANGE, MILES_TO_WIN);
  const endingTimes = g.endingTimes === 2 ? 2 : 1;
  const names = Array.from({ length: MAX_PLAYERS }, (_, k) => String(g.names[k] ?? '').slice(0, 20));
  const textSizes = { ...s.textSizes };
  for (const area of Object.keys(TEXT_RANGE) as TextArea[]) {
    const v = Number(textSizes[area]), { min, max } = TEXT_RANGE[area];
    textSizes[area] = v > 0 ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : 1;
  }
  const musicVolume = Number.isFinite(s.musicVolume) ? clampInt(s.musicVolume, 0, 100) : 50;
  const musicLinks = (Array.isArray(s.musicLinks) ? s.musicLinks : []).map(l => String(l).trim().slice(0, 500)).filter(Boolean).slice(0, 50);
  const botNames = Array.from({ length: MAX_PLAYERS }, (_, k) => String((Array.isArray(s.botNames) ? s.botNames : [])[k] ?? '').slice(0, BOT_NAME_MAX));
  return { ...s, game: { ...g, players, bots, difficulties: levels, ending, endingTimes, minutes, miles, names }, textSizes, musicVolume, musicLinks, botNames,
    musicSource: s.musicSource === 'mine' ? 'mine' : 'default',
    musicSong: s.musicSong === 'all' || SONGS.some(x => x.id === s.musicSong) ? s.musicSong : SONGS[0]!.id };
}

/** Read the saved settings over `base`. Missing or broken values keep `base`'s. */
export function loadUiSettings(store: SaveStore, base: UiSettings): UiSettings {
  const get = (k: string) => store.prefGet(k);
  const num = (k: string, d: number) => { const v = get(k); return v === '' || !Number.isFinite(+v) ? d : +v; };
  const g = base.game;
  const levels = Array.from({ length: MAX_PLAYERS }, (_, k) => OLD_TO_LEVEL[get('ai' + (k + 1))] ?? g.difficulties[k] ?? DEFAULT_LEVELS[k]!);
  const textSizes = { ...base.textSizes };
  for (const area of Object.keys(TEXT_PREF) as TextArea[]) textSizes[area] = num('ts_' + TEXT_PREF[area], textSizes[area]);
  // (Player 1's name isn't copied from the account here: it's looked up when each game starts, so a
  // name changed on the Account screen shows in the next game. See playerOneName in start.ts.)
  const names = [...g.names];
  const mode = get('mode'), music = get('music');
  const links = (v: string, d: string[]) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : d; } catch { return d; } };
  return clampSettings({
    ...base,
    game: {
      ...g,
      players: num('players', g.players),
      bots: num('ai', g.bots),
      ending: num('ending', g.ending) as Ending,
      endingTimes: num('times', g.endingTimes) as 1 | 2,
      minutes: num('minutes', g.minutes ?? DEFAULT_MINUTES),
      miles: num('miles', g.miles ?? MILES_TO_WIN),
      difficulties: levels,
      names,
    },
    gameMode: mode === 'Multiplayer' ? 'multiplayer' : mode === "Pass'n'Play" ? 'passnplay' : base.gameMode,
    sound: get('sound') === '' ? base.sound : get('sound') !== '0',
    musicMode: music === 'Play One' ? 'one' : music === 'Cycle All' ? 'cycle' : base.musicMode,
    music: get('musicon') === '' ? base.music : get('musicon') === '1',
    musicVolume: num('musicvol', base.musicVolume),
    musicSource: get('musicsrc') === 'mine' ? 'mine' : get('musicsrc') === 'default' ? 'default' : base.musicSource,
    musicLinks: links(get('musiclinks'), base.musicLinks),
    musicSong: get('musicsong') || base.musicSong,
    botNames: links(get('botnames'), base.botNames),
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
  put('minutes', String(g.minutes ?? DEFAULT_MINUTES));
  put('miles', String(g.miles ?? MILES_TO_WIN));
  put('sound', s.sound ? '1' : '0');
  put('mode', s.gameMode === 'multiplayer' ? 'Multiplayer' : "Pass'n'Play");
  put('music', s.musicMode === 'one' ? 'Play One' : 'Cycle All');
  put('musicon', s.music ? '1' : '0');
  put('musicvol', String(s.musicVolume));
  put('musicsrc', s.musicSource);
  put('musiclinks', JSON.stringify(s.musicLinks));
  put('musicsong', s.musicSong);
  put('botnames', JSON.stringify(s.botNames));
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
