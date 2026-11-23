// Starting games from the menu (docs/game-rules.md section 2, Cards › Start Request). No sign-in is
// needed to play (owner decision: guest play).
import { nameIsOk } from '../../services/names/name-filter';
import type { GameSettings } from '../../game';
import { getUser } from '../../services/account/user';
import { browserStorage, SaveStore } from '../../services/storage';
import { screen, settings, startLocalGame } from '../app-state';
import { createStore } from '../store';
import { services } from '../services';
import { BOT_NAME_MAX, MAX_PLAYERS } from './prefs';
import { cleanName } from '../../services/online';
import { polite } from '../../services/feedback/filter';

/** A choice to act on as the Online screen opens (quick match, host a room, join with a code). */
export type OnlineIntent = 'quick' | 'host' | 'join';
export const onlineIntent = createStore<OnlineIntent | null>(null);

/** The game's settings as the engine wants them: one difficulty per bot actually playing. */
export function gameSettingsFor(players: number, bots: number, base: GameSettings = settings.get().game): GameSettings {
  // A rude name saved before names were checked: "Player 2" instead
  const names = base.names.slice(0, players).map(n => (nameIsOk(n) ? n : ''));
  // Player 1 is you: with no name typed for them, use your name (home page / Account & Store) as it is now
  if (bots < players && !(names[0] ?? '').trim()) names[0] = playerOneName();
  // Bots: the names you gave them, or their usual ones
  for (let k = 0; k < bots; k++) names[players - bots + k] = botName(settings.get().botNames[k] ?? '');
  return {
    ...base,
    players,
    bots,
    // Insane bots are for Gold members: without Gold they play as Hard
    difficulties: base.difficulties.slice(0, MAX_PLAYERS).slice(0, bots).map(d => (d === 'insane' && !services.player.get().gold ? 'hard' : d)),
    names,
    // Your seat shows your Gold star
    gold: bots < players && services.player.get().gold ? [true] : [],
  };
}

/** "Bot <name>" for a name you gave a bot (rude words starred out); '' keeps its usual name. */
export function botName(typed: string): string {
  const name = polite(cleanName(typed)).replace(/^bot\s+/i, '').trim().slice(0, BOT_NAME_MAX);
  return name ? 'Bot ' + name : '';
}

/** The name you chose (or your Google name), read fresh each time; '' = none, so the seat is "Player 1". */
export function playerOneName(store: SaveStore = new SaveStore(browserStorage())): string {
  const name = (store.get('name') || getUser(store)?.name || store.get('gname') || '').trim().slice(0, 20);
  return nameIsOk(name) ? name : '';
}

/** Pass'n'Play: everyone on this device, plus any bots. Bots for every seat is watch mode. */
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
  const g = settings.get().game;
  startLocalGame({ ...gameSettingsFor(g.players, g.players - 1), firstSeat: 0 });   // learning: you go first
}
