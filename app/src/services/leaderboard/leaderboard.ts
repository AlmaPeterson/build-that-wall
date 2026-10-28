import { isError, isServerUrl, type ServerApi } from '../account/api';
import { myName } from '../account/user';
import type { SaveStore } from '../storage';

export interface PlayerStats { games: number; wins: number; best: number; walls: number; spent?: number; at?: number }
export type Board = Record<string, PlayerStats>;
export interface BoardRow extends PlayerStats { name: string }

export type BoardKind = 'miles' | 'rate' | 'games' | 'wins' | 'walls' | 'spent';

// The worldwide board: one shared, retained message on a public MQTT topic.
// TODO: implement with the online service's MQTT client (brokers and topic below), once that fork lands.
export interface WorldBoardTransport {
  // Read the board; with `update`, merge it in and publish the result. null = couldn't connect.
  readAndUpdate(update: Board | null): Promise<Board | null>;
}

export const WORLD_BOARD_TOPIC = 'btwwall/v1/leaderboard';
export const WORLD_BOARD_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];
export const WORLD_BOARD_MAX = 500;

const blank = (): PlayerStats => ({ games: 0, wins: 0, best: 0, walls: 0, spent: 0 });

// Merge new totals into the world board: every number only goes up. Keeps the 500 most recently updated.
export function mergeWorldBoard(board: Board, update: Board, now = Date.now()): Board {
  const out: Board = { ...board };
  for (const [name, r] of Object.entries(update)) {
    const o: Partial<PlayerStats> = out[name] || {};
    out[name] = { games: Math.max(o.games || 0, r.games || 0), wins: Math.max(o.wins || 0, r.wins || 0), best: Math.max(o.best || 0, r.best || 0),
      walls: Math.max(o.walls || 0, r.walls || 0), spent: Math.max(o.spent || 0, r.spent || 0), at: now };
  }
  const names = Object.keys(out).sort((x, y) => (out[y]!.at || 0) - (out[x]!.at || 0)).slice(0, WORLD_BOARD_MAX);
  const trimmed: Board = {};
  for (const n of names) trimmed[n] = out[n]!;
  return trimmed;
}

const VALUE: Record<BoardKind, (r: BoardRow) => number> = {
  miles: r => r.best, rate: r => (r.games >= 5 ? r.wins / r.games : -1), games: r => r.games,
  wins: r => r.wins, walls: r => r.walls, spent: r => r.spent || 0,
};
const FORMAT: Record<BoardKind, (r: BoardRow) => string> = {
  miles: r => r.best + ' miles', rate: r => Math.round(100 * r.wins / r.games) + '% of ' + r.games + ' games',
  games: r => r.games + ' games', wins: r => r.wins + ' wins', walls: r => r.walls + ' walls built',
  spent: r => (r.spent || 0).toFixed(2) + ' spent',
};

// Top 10 lines like "1.  Alex   42 miles"
export function topTen(rows: BoardRow[], kind: string): string[] {
  const k = (kind in VALUE ? kind : 'miles') as BoardKind;
  const val = VALUE[k];
  // NOTE: an unknown kind sorted by miles but had no formatter before (crashed); it now formats as miles too
  const fmt = FORMAT[k];
  return rows.filter(r => val(r) > 0).sort((x, y) => val(y) - val(x)).slice(0, 10).map((r, i) => (i + 1) + '.  ' + r.name + '   ' + fmt(r));
}

export class Leaderboard {
  constructor(
    private readonly store: SaveStore,
    private readonly api: ServerApi,
    private readonly world: WorldBoardTransport | null = null,
  ) {}

  local(): Board { return this.store.getJson<Board>('lb', {}); }

  // After a game: this device's board has every player who played here
  recordLocal(nameIn: string, won: boolean, miles: number, walls: number): void {
    const name = String(nameIn || '').trim(); if (!name) return;
    const lb = this.local(); const r = lb[name] || blank();
    r.games++; if (won) r.wins++; r.best = Math.max(r.best, +miles || 0); r.walls += +walls || 0;
    lb[name] = r; this.store.setJson('lb', lb);
  }

  // Money spent shows on the "spent" board, under this player's name
  addSpent(amount: number): void {
    const lb = this.local(), name = myName(this.store); const r = lb[name] || blank();
    r.spent = Math.round(((r.spent || 0) + (+amount || 0)) * 100) / 100;
    lb[name] = r; this.store.setJson('lb', lb);
  }

  // Share these players' totals with the world board (fire and forget)
  submitWorld(names: string[]): void {
    const lb = this.local(), up: Board = {};
    for (const n of names) if (n && lb[n]) up[n] = lb[n]!;
    if (Object.keys(up).length && this.world) void this.world.readAndUpdate(up);
  }

  // The game server's board if there is one, otherwise the world board plus this device's
  async load(server: string, kind: string): Promise<string[]> {
    let rows: BoardRow[] | null = null;
    if (isServerUrl(server)) {
      const r = await this.api.call<{ players?: BoardRow[] }>(server, '/leaderboard', null);
      if (r && !isError(r) && r.players) rows = r.players;
    }
    if (!rows) {
      const lb = this.local(), world = (this.world && await this.world.readAndUpdate(null)) || {};
      const all: Board = { ...world };
      for (const n in lb) all[n] = { ...(all[n] || blank()), ...lb[n]! };
      rows = Object.keys(all).map(n => ({ name: n, ...all[n]! }));
    }
    return topTen(rows, kind);
  }
}
