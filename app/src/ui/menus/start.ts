// Starting games from the menu (docs/game-rules.md section 2, Cards › Start Request). No sign-in is
// needed to play (owner decision: guest play).
import type { GameSettings } from '../../game';
import { screen, settings, startLocalGame } from '../app-state';
import { createStore } from '../store';
import { MAX_PLAYERS } from './prefs';

/** What the player picked in the Multiplayer menu, for the Online screen to act on. */
export type OnlineIntent = 'quick' | 'host' | 'join';
export const onlineIntent = createStore<OnlineIntent | null>(null);

/** The game's settings as the engine wants them: one difficulty per bot actually playing. */
export function gameSettingsFor(players: number, bots: number, base: GameSettings = settings.get().game): GameSettings {
  return {
    ...base,
    players,
    bots,
    difficulties: base.difficulties.slice(0, MAX_PLAYERS).slice(0, bots),
    names: base.names.slice(0, players),
  };
}

/** Start Game in Pass'n'Play: everyone on this device. Bots for every seat is watch mode. */
export function startPassNPlay(): void {
  const g = settings.get().game;
  startLocalGame(gameSettingsFor(g.players, Math.min(g.bots, g.players)));
}

/** "Play against bots on this device": you and Players - 1 bots. */
export function startVsBots(): void {
  const g = settings.get().game;
  startLocalGame(gameSettingsFor(g.players, g.players - 1));
}

/** Watch bots play each other. */
export function startWatch(): void {
  const g = settings.get().game;
  startLocalGame(gameSettingsFor(g.players, g.players));
}

/** Quick match, host a room or join with a code: the Online screen takes it from here. */
export function goOnline(intent: OnlineIntent): void {
  onlineIntent.set(intent);
  screen.set('online');
}

/** The Tutorial: tips on for the player, against bots on this device. */
export function startTutorialGame(): void {
  settings.set({ ...settings.get(), tutorial: true });
  startVsBots();
}
