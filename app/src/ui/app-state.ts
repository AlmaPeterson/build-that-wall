// App-wide state: which screen is showing, the player's settings, and the running game.
import { DEFAULT_SETTINGS, type GameSettings } from '../game';
import { GameController, type ControllerOptions } from './controller';
import { createStore } from './store';

export type Screen = 'menu' | 'settings' | 'instructions' | 'game' | 'account' | 'online' | 'leaderboard';

export type AnimSpeed = 'slow' | 'normal' | 'fast' | 'off';
/** How long card movements take, as a multiple of Normal. */
export const ANIM_FACTOR: Record<AnimSpeed, number> = { slow: 1.6, normal: 1, fast: 0.55, off: 0 };

export type TextArea = 'menu' | 'board' | 'cards' | 'popups';

/** Everything on the Settings screen (docs/game-rules.md section 2), plus the game's own settings. */
export interface UiSettings {
  game: GameSettings;
  gameMode: 'passnplay' | 'multiplayer';
  sound: boolean;
  musicMode: 'cycle' | 'one';
  autoJoin: boolean;
  tutorial: boolean;
  animSpeed: AnimSpeed;
  textSizes: Record<TextArea, number>;   // 1 = normal
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  game: { ...DEFAULT_SETTINGS, players: 2, bots: 1, difficulties: ['medium'] },
  gameMode: 'passnplay', sound: true, musicMode: 'cycle', autoJoin: false, tutorial: false,
  animSpeed: reducedMotion() ? 'off' : 'normal',
  textSizes: { menu: 1, board: 1, cards: 1, popups: 1 },
};

function reducedMotion(): boolean {
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export const screen = createStore<Screen>('menu');
export const settings = createStore<UiSettings>(DEFAULT_UI_SETTINGS);
export const controller = createStore<GameController | null>(null);

/** How games on this device run: bots pause (after their moves have been shown) so people can follow them; services add the bots' saved memory. */
export const gameOptions: ControllerOptions = { passScreen: true, botDelay: 350, watchDelay: 700 };

/** Start a game on this device with the current settings and show the board. */
export function startLocalGame(game: GameSettings = settings.get().game): GameController {
  controller.get()?.stop();
  const c = new GameController(gameOptions);
  controller.set(c);
  screen.set('game');
  void c.start(game);
  return c;
}

/** Leave a side screen (settings, instructions, ...): back to the running game if there is one, else the menu. */
export function goBack(): void {
  const c = controller.get();
  screen.set(c?.state && !c.state.over ? 'game' : 'menu');
}
