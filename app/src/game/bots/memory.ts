// What Hard bots remember about each human, kept on this device (docs/game-rules.md section 11, learning).
// Same storage as the old game: key "aimem" holds {"<name>": {games, debt, attack, miles}},
// so pass the save store (it adds the "btw:" prefix), and existing players' bot memory still works.
import type { BotMemory } from '../contracts';
import type { GameEvent, GameState } from '../types';

export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void }

interface Record_ { games: number; debt: number; attack: number; miles: number }

const KEY = 'aimem';

/** Cards that count as an attack when a human plays them. */
export const ATTACK_CARDS: readonly number[] = [5, 6, 9, 16, 17, 21, 49];

export function createBotMemory(store: KeyValueStore): BotMemory {
  const load = (): Record<string, Record_> => {
    try { return JSON.parse(store.get(KEY) || '{}') as Record<string, Record_>; } catch { return {}; }
  };
  return {
    learn(nameIn, what, miles) {
      const name = String(nameIn || '').trim();
      if (!name) return;
      const m = load();
      const r = m[name] || { games: 0, debt: 0, attack: 0, miles: 0 };
      if (what === 'game') { r.games++; r.miles += Number(miles) || 0; }
      else r[what] = (r[what] || 0) + 1;
      m[name] = r;
      store.set(KEY, JSON.stringify(m));
    },
    rate(nameIn, what) {
      const r = load()[String(nameIn || '').trim()];
      if (!r) return 0;
      const g = Math.max(1, r.games);
      return what === 'miles' ? Math.round(r.miles / g) : Math.round(((r.debt || 0) / g) * 100) / 100;
    },
  };
}

/**
 * Learn from what happened. The engine emits one 'play' event per card actually played, so each
 * Debt counts once (the old game counted it once per card on screen) and each attack is put down
 * to the human who played it. At 'gameOver' every human's miles are recorded.
 * The caller skips this in Test Mode, as the old game did.
 */
export function learnFromEvent(memory: BotMemory, event: GameEvent, state: Readonly<GameState>): void {
  const human = (s: number | undefined) => s !== undefined && state.seats[s] != null && state.seats[s]!.bot === null;
  if (event.type === 'play' && human(event.seat) && event.card !== undefined) {
    const name = state.seats[event.seat!]!.name;
    if (event.card === 7) memory.learn(name, 'debt');
    else if (ATTACK_CARDS.includes(event.card)) memory.learn(name, 'attack');
  }
  if (event.type === 'gameOver' && state.over) {
    state.seats.forEach((s, i) => { if (s.bot === null) memory.learn(s.name, 'game', state.over!.miles[i] ?? 0); });
  }
}
