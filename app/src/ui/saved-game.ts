// A game on this device is saved as it goes ("btw:game"), so reloading the page, or closing it by accident
// and coming back, takes you straight back into it. It's forgotten when the game ends, when End Game is
// pressed, and when another game starts. Online games aren't saved.
import { browserStorage, SaveStore } from '../services/storage';
import { controller, gameOptions, screen, setLocalControllerFactory } from './app-state';
import { GameController, type SavedGame } from './controller';
import { createStore } from './store';
import { services } from './services';

const KEY = 'game';
/** Gold: games put aside when another one started, to carry on later ("btw:games"). */
const PARKED = 'games';
/** Gold members keep up to this many games going: the one on now and the ones put aside. */
export const GOLD_SLOTS = 5;

export interface ParkedGame extends SavedGame { id: string }

/** The games put aside, newest first (for the home page). */
export const parkedGames = createStore<ParkedGame[]>([]);
/** A game left this long ago isn't brought back. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let saving: GameController | null = null;
let watching = false;

const store = () => new SaveStore(browserStorage());

export function loadSavedGame(s: SaveStore = store(), now = Date.now()): SavedGame | null {
  const saved = s.getJson<SavedGame | null>(KEY, null);
  if (!saved || saved.v !== 1 || !saved.state?.seats?.length || saved.state.over || !Array.isArray(saved.events)) return null;
  if (!(now - saved.savedAt < MAX_AGE_MS)) return null;
  return saved;
}

export function clearSavedGame(s: SaveStore = store()): void { s.remove(KEY); }

export function loadParked(s: SaveStore = store(), now = Date.now()): ParkedGame[] {
  const list = s.getJson<ParkedGame[]>(PARKED, []);
  return (Array.isArray(list) ? list : []).filter(g => g && g.v === 1 && g.state?.seats?.length && !g.state.over && now - g.savedAt < 30 * 24 * 60 * 60 * 1000);
}

function saveParked(list: ParkedGame[], s: SaveStore = store()): void {
  if (list.length) s.setJson(PARKED, list); else s.remove(PARKED);
  parkedGames.set(list);
}

/** Gold: the game in progress is put aside instead of forgotten when another game starts. */
function parkCurrent(s: SaveStore = store()): void {
  const saved = loadSavedGame(s);
  if (!saved || !services.player.get().gold) return;
  const list = [{ ...saved, id: saved.savedAt.toString(36) + Math.random().toString(36).slice(2, 6) }, ...loadParked(s)];
  saveParked(list.slice(0, GOLD_SLOTS - 1), s);
}

/** "You and 2 bots · turn 12 · 3 h ago": what a saved game was. */
export function parkedTitle(g: SavedGame, now = Date.now()): string {
  const seats = g.state.seats, bots = seats.filter(x => x.bot).length, people = seats.length - bots;
  const who = people > 1 ? people + ' people' + (bots ? ' and ' + bots + (bots === 1 ? ' bot' : ' bots') : '') : 'You and ' + bots + (bots === 1 ? ' bot' : ' bots');
  const mins = Math.max(0, Math.round((now - g.savedAt) / 60000));
  const ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' days ago';
  return who + ' · turn ' + g.state.turnCount + ' · ' + ago;
}

/** Forget a game put aside. */
export function deleteParked(id: string): void { saveParked(loadParked().filter(g => g.id !== id)); }

/** Carry on a game that was put aside (the game on now is put aside in its place). */
export function resumeParked(id: string): boolean {
  const g = loadParked().find(x => x.id === id);
  if (!g) return false;
  const { id: _id, ...saved } = g;
  void _id;
  saveParked(loadParked().filter(x => x.id !== id));
  controller.get()?.stop();
  const c = savingController();               // puts the current game aside
  store().setJson(KEY, saved);
  controller.set(c);
  screen.set('game');
  void c.resume(saved as SavedGame).catch(() => {});
  return true;
}

/** Forget the save as soon as a different game (or none) is on: End Game, an online game, a new game. */
function watch(): void {
  if (watching) return;
  watching = true;
  parkedGames.set(loadParked());
  controller.subscribe(c => {
    if (c === saving) return;
    saving = null;
    if (c) parkCurrent();                     // another game (online): Gold keeps this one
    clearSavedGame();
  });
}

/** A new controller for a game on this device that saves itself as it goes. Not shown yet: set it in `controller`. */
export function savingController(park = true): GameController {
  watch();
  const s = store();
  if (park) parkCurrent(s);                    // a new game: Gold keeps the one that was going
  const c: GameController = new GameController({
    ...gameOptions,
    onSave: saved => {
      if (saving !== c) return;                     // a game that has been replaced doesn't save any more
      if (saved) s.setJson(KEY, saved); else clearSavedGame(s);
    },
  });
  saving = c;
  return c;
}

/** Page load: if a game on this device was left part-way, go straight back into it. True if one was. */
export function resumeSavedGame(): boolean {
  const saved = loadSavedGame();
  if (!saved) { clearSavedGame(); return false; }
  const c = savingController(false);
  try {
    controller.set(c);
    screen.set('game');
    void c.resume(saved).catch(() => {});
    return true;
  } catch {
    // A save the game can't read any more (an older version): start fresh
    saving = null;
    controller.set(null);
    screen.set('menu');
    clearSavedGame();
    return false;
  }
}

setLocalControllerFactory(savingController);
