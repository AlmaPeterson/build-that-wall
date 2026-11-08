// A game on this device is saved as it goes ("btw:game"), so reloading the page, or closing it by accident
// and coming back, takes you straight back into it. It's forgotten when the game ends, when End Game is
// pressed, and when another game starts. Online games aren't saved.
import { browserStorage, SaveStore } from '../services/storage';
import { controller, gameOptions, screen, setLocalControllerFactory } from './app-state';
import { GameController, type SavedGame } from './controller';

const KEY = 'game';
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

/** Forget the save as soon as a different game (or none) is on: End Game, an online game, a new game. */
function watch(): void {
  if (watching) return;
  watching = true;
  controller.subscribe(c => {
    if (c === saving) return;
    saving = null;
    clearSavedGame();
  });
}

/** A new controller for a game on this device that saves itself as it goes. Not shown yet: set it in `controller`. */
export function savingController(): GameController {
  watch();
  const s = store();
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
  const c = savingController();
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
