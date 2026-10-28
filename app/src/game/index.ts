// The game core's public API. Pure logic: no DOM, no network.
export * from './types';
export * from './contracts';
export * from './cardinfo';
export { Game, type GameOptions } from './engine/game';
export { createGame, BOT_NAMES } from './engine/setup';
export { viewFor, redactEvent, CARD_BACK } from './engine/view';
export * as board from './engine/board';
export { createLocalGame, type LocalGameOptions } from './local';
