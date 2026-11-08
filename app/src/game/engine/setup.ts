// Starting a game (`Cards › New Game`, docs/game-rules.md section 2).
import { baseDeck } from '../../data/cards';
import { insertionShuffle, randomInt } from '../rng';
import type { Difficulty, GameSettings, GameState } from '../types';

/** Bots are shown as "Bot <name>", picked by seat number (`Bot Names`). */
export const BOT_NAMES = ['Freedom', 'Maverick', 'Liberty', 'Eagle', 'Patriot', 'Senator'] as const;

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

export function createGame(settingsIn: GameSettings, seed: number): GameState {
  // Anything outside 2-6 players becomes 6, as New Game does
  const players = settingsIn.players >= 2 && settingsIn.players <= 6 ? Math.floor(settingsIn.players) : 6;
  const bots = Math.max(0, Math.min(Math.floor(settingsIn.bots), players));
  const settings: GameSettings = { ...settingsIn, players, bots };
  const state: GameState = {
    settings,
    rng: seed | 0,
    seats: [],
    draw: [],
    discard: [],
    jail: [],
    resolving: [],
    jailRelease: 0,
    trainGuards: [],
    turn: -1,
    turnCount: 0,
    actionsLeft: 0,
    exhaustCount: 0,
    exhaustPending: 0,
    exhaustFlag: false,
    final: null,
    deckDone: false,
    over: null,
  };
  // Every card of the deck (and active pack cards) goes in at a random position
  state.draw = insertionShuffle(state, [...baseDeck(), ...settings.packCards]);
  const firstBot = players - bots;
  for (let seat = 0; seat < players; seat++) {
    let bot: Difficulty | null = null;
    if (seat >= firstBot) {
      const k = seat - firstBot;
      // The old default list: Easy for bots 1-5, Medium for bot 6
      const want = settings.difficulties[k] ?? (k < 5 ? 'easy' : 'medium');
      bot = want === 'random' ? LEVELS[randomInt(state, 0, 2)]! : want;
    }
    const custom = (settings.names[seat] ?? '').trim();
    state.seats.push({
      name: custom || (bot ? 'Bot ' + BOT_NAMES[seat] : 'Player ' + (seat + 1)),
      bot,
      hand: [],
      walls: [],
      skipNext: false,
      skipBy: 0,
      quarantine: 0,
      limitNext: 0,
      left: false,
    });
  }
  return state;
}
