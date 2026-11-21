// Detailed stats (shown to Gold members): one line per game played, kept in "btw:stat_log" (it follows a
// signed-in player like the other stats), and summaries worked out from it. Pure functions apart from the store.
import type { CardId, Difficulty, GameEvent, GameState, Seat } from '../../game';
import type { SaveStore } from '../storage';

export type GameMode = 'bots' | 'pass' | 'online' | 'watch';

/** One finished game, from this player's side. */
export interface GameLine {
  t: number;                    // when it ended (ms since 1970)
  mode: GameMode;
  diff: Difficulty | '';        // the hardest bot in it ('' = no bots)
  won: boolean;
  miles: number;
  walls: number;
  players: number;
  plays: Partial<Record<CardId, number>>;   // cards this player played
}

export const STAT_LOG_KEY = 'stat_log';
/** The most games kept. */
export const STAT_LOG_MAX = 80;    // the game server keeps up to 20,000 characters per saved value

const ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'insane'];

/** The hardest bot in a game. */
export function hardestBot(state: Pick<GameState, 'seats'>): Difficulty | '' {
  let best = -1;
  for (const s of state.seats) if (s.bot && !s.standIn) best = Math.max(best, ORDER.indexOf(s.bot));
  return best >= 0 ? ORDER[best]! : '';
}

/** How many times `seat` played each card. */
export function cardsPlayed(events: readonly GameEvent[], seat: Seat): Partial<Record<CardId, number>> {
  const out: Partial<Record<CardId, number>> = {};
  for (const e of events) if (e.type === 'play' && e.seat === seat && e.card !== undefined) out[e.card] = (out[e.card] ?? 0) + 1;
  return out;
}

export function lineFor(state: Readonly<GameState>, seat: Seat, mode: GameMode, events: readonly GameEvent[], now = Date.now()): GameLine | null {
  const over = state.over, me = state.seats[seat];
  if (!over || !me) return null;
  return {
    t: now, mode, diff: hardestBot(state), won: over.winners.includes(seat), miles: over.miles[seat] ?? 0,
    walls: me.walls.length, players: state.seats.length, plays: cardsPlayed(events, seat),
  };
}

export function loadLog(store: SaveStore): GameLine[] {
  const l = store.getJson<GameLine[]>(STAT_LOG_KEY, []);
  return Array.isArray(l) ? l.filter(x => x && typeof x.t === 'number') : [];
}

export function addLine(store: SaveStore, line: GameLine): void {
  store.setJson(STAT_LOG_KEY, [...loadLog(store), line].slice(-STAT_LOG_MAX));
}

export interface Rate { games: number; wins: number }
export interface Summary {
  games: number;
  wins: number;
  byMode: Partial<Record<GameMode, Rate>>;
  byDiff: Partial<Record<Difficulty, Rate>>;
  best: GameLine | null;            // the game with the most miles
  avgMiles: number;
  favourite: { card: CardId; times: number } | null;
  streak: number;                   // wins in a row, up to the last game
  bestStreak: number;
  recent: GameLine[];               // the last 20 games, oldest first (for the chart)
}

export function summarize(log: readonly GameLine[]): Summary {
  const add = (m: Partial<Record<string, Rate>>, k: string, won: boolean) => {
    const r = m[k] ?? { games: 0, wins: 0 };
    r.games++; if (won) r.wins++;
    m[k] = r;
  };
  const byMode: Partial<Record<GameMode, Rate>> = {}, byDiff: Partial<Record<Difficulty, Rate>> = {};
  const cards = new Map<CardId, number>();
  let best: GameLine | null = null, wins = 0, miles = 0, streak = 0, bestStreak = 0;
  for (const g of log) {
    add(byMode, g.mode, g.won);
    if (g.diff) add(byDiff, g.diff, g.won);
    if (g.won) { wins++; streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0;
    miles += g.miles;
    if (!best || g.miles > best.miles) best = g;
    for (const [id, n] of Object.entries(g.plays ?? {})) cards.set(+id as CardId, (cards.get(+id as CardId) ?? 0) + (n ?? 0));
  }
  let favourite: Summary['favourite'] = null;
  for (const [card, times] of cards) if (!favourite || times > favourite.times) favourite = { card, times };
  return {
    games: log.length, wins, byMode, byDiff, best, avgMiles: log.length ? Math.round(miles / log.length) : 0,
    favourite, streak, bestStreak, recent: log.slice(-20),
  };
}

export const pct = (r: Rate | undefined): string => (r && r.games ? Math.round((100 * r.wins) / r.games) + '%' : '-');
