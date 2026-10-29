// An online session for the Online screen: quick match, host a room, join with a code, the lobby,
// starting the game (host) and following it (players).
import type { BotMemory, Difficulty, GameSettings } from '../../game';
import { OnlineRoom, cleanName, type AskMsg, type Connect } from '../../services/online';
import type { GameController } from '../controller';
import { createStore, type Store } from '../store';
import { OnlineClientController } from './client';
import { HostController } from './host';
import { ASK_MODE, isToHost, isToPlayer, type LobbyPlayer, type ToPlayer } from './messages';

export type Phase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'ended';
export type BotLevel = Difficulty | 'random';
const LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'random'];

export interface OnlineState {
  phase: Phase;
  role: '' | 'host' | 'client';
  code: string;
  /** This device's room seat (1 = host). */
  seat: number;
  players: LobbyPlayer[];
  bots: number;
  /** Host: each bot's difficulty (bot k = difficulties[k]); 'random' picks one when the game starts. */
  difficulties: BotLevel[];
  status: string;
  error: string;
  /** "Still here?" is showing: when it runs out (Date.now() ms); 0 = not asked. */
  still: number;
  /** A message to show after being taken out of an online game (e.g. away too long); '' = none. */
  notice: string;
}

export interface SessionDeps {
  connect: Connect;
  /** This player's name. */
  name: () => string;
  /** Game settings to start from (ending, difficulties...). */
  baseSettings: () => GameSettings;
  memory?: BotMemory;
  /** Show a running game on this device (sets the board's controller and screen). */
  show: (c: GameController) => void;
  autoJoin?: () => boolean;
  random?: () => number;
  /** Waits between auto-join tries (replaced in tests). */
  wait?: (ms: number) => Promise<void>;
  /** Back to the main menu (this player left the online game). */
  home?: () => void;
}

const IDLE: OnlineState = { phase: 'idle', role: '', code: '', seat: 1, players: [], bots: 0, difficulties: [], status: '', error: '', still: 0, notice: '' };
export const AWAY_NOTICE = "You didn't answer \"Still here?\" in time, so you've left the online game.";
const AUTO_JOIN_TRIES = 20, AUTO_JOIN_MS = 2000;

export class OnlineSession {
  readonly state: Store<OnlineState> = createStore<OnlineState>({ ...IDLE });
  private room: OnlineRoom;
  private host: HostController | null = null;
  private client: OnlineClientController | null = null;
  private names = new Map<number, string>();
  private running = false;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: SessionDeps) {
    this.room = this.makeRoom();
  }

  /** The game controller on this device, once a game started. */
  get controller(): GameController | null { return this.host ?? this.client; }

  private set(patch: Partial<OnlineState>): void { this.state.set({ ...this.state.get(), ...patch }); }

  private makeRoom(): OnlineRoom {
    return new OnlineRoom(this.deps.connect, {
      getState: () => null,
      applyState: () => {},
      isRunning: () => this.running && !this.controller?.state?.over,
      turn: () => (this.controller?.state?.turn ?? -1) + 1,
      turnOwner: () => 1,
      autoSync: false,
    }, {
      onData: (data, from) => this.onData(data, from),
      onAsk: q => this.onAsk(q),
      onJoin: seat => { if (!this.names.has(seat)) this.names.set(seat, 'Player ' + seat); this.lobby(); },
      onPlayerLeft: seat => this.onPlayerLeft(seat),
      onHostLost: () => this.set({ phase: 'ended', error: 'The host left the game.' }),
      onStatus: status => this.set({ status }),
      // Back after a dropped connection: anything sent meanwhile was missed, so catch up
      onReconnected: () => {
        if (this.room.role === 'client' && this.client) this.room.sendData(1, { k: 'resync' });
        else if (this.room.role === 'host') this.host?.resyncAll();
      },
      onStillAsk: msLeft => this.askedStill(msLeft),
      onDropped: () => this.away(),
      // Host: they're back; send them everything again
      onStillHere: seat => { const g = this.host?.gameSeat(seat) ?? -1; if (g > 0) this.host?.resyncSeat(g); },
    }, this.deps.random);
  }

  // ---- getting into a room

  async hostRoom(max = 6): Promise<boolean> {
    this.reset('Opening a room...');
    const code = await this.room.host({ max });
    if (!code) return this.failed();
    this.names.set(1, cleanName(this.deps.name()) || 'Player 1');
    this.set({ phase: 'lobby', role: 'host', code, seat: 1, status: '', difficulties: this.startingLevels() });
    this.lobby();
    return true;
  }

  async join(code: string): Promise<boolean> {
    this.reset('Joining ' + code.toUpperCase() + '...');
    const tries = this.deps.autoJoin?.() ? AUTO_JOIN_TRIES : 1;
    let seat = 0;
    for (let i = 0; i < tries && seat <= 0; i++) {
      if (i) { this.set({ status: 'Waiting for the host to open ' + code.toUpperCase() + '... (' + (i + 1) + ' of ' + tries + ')' }); await (this.deps.wait ?? sleep)(AUTO_JOIN_MS); }
      if (this.state.get().phase !== 'connecting') return false;      // the player gave up
      seat = await this.room.join(code);
    }
    if (seat <= 0) return this.failed();
    this.joined(seat);
    return true;
  }

  async quick(max = 6): Promise<boolean> {
    this.reset('Connecting to the online service...');
    const seat = await this.room.quick(max);
    if (seat <= 0) return this.failed();
    if (this.room.role === 'host') {
      this.names.set(1, cleanName(this.deps.name()) || 'Player 1');
      this.set({ phase: 'lobby', role: 'host', code: this.room.code, seat: 1, status: '', error: '', difficulties: this.startingLevels() });
      this.lobby();
    } else this.joined(seat);
    return true;
  }

  private joined(seat: number): void {
    this.client = new OnlineClientController(msg => this.room.sendData(1, msg));
    this.set({ phase: 'lobby', role: 'client', code: this.room.code, seat, status: 'Waiting for the host to start...', error: '' });
    this.room.sendData(1, { k: 'name', name: cleanName(this.deps.name()) || 'Player ' + seat });
  }

  /** The page went into the background (another window or app) or came back. */
  pageVisible(visible: boolean): void { this.room.setAway(!visible); }

  /** The page is closing for good: say goodbye now, so nobody waits for us. */
  pageClosing(): void { this.room.leave(); }

  leave(): void {
    this.room.leave();
    this.running = false;
    this.host = null; this.client = null; this.names.clear();
    this.clearStill();
    this.state.set({ ...IDLE });
  }

  // ---- "Still here?"

  /** The host hasn't heard from us: show "Still here?" with a countdown (asked again every few seconds). */
  private askedStill(msLeft: number): void {
    if (this.state.get().still) return;                       // already showing: keep its own countdown
    this.set({ still: Date.now() + msLeft });
    this.stillTimer = setTimeout(() => this.away(), msLeft);
  }

  /** "Still here" was clicked: stay in the game and catch up on anything missed. */
  stillHere(): void {
    if (!this.state.get().still) return;
    this.clearStill();
    this.set({ still: 0 });
    this.room.stillHere();
    if (this.client) this.room.sendData(1, { k: 'resync' });
  }

  /** Too late (or the host gave up on us): we've left the game; back to the menu with a message. */
  private away(): void {
    this.leave();
    this.set({ notice: AWAY_NOTICE });
    this.deps.home?.();
  }

  /** The player has read the notice. */
  clearNotice(): void { this.set({ notice: '' }); }

  private clearStill(): void {
    if (this.stillTimer) clearTimeout(this.stillTimer);
    this.stillTimer = null;
  }

  /** Host: how many bots join the online players. */
  setBots(n: number): void {
    const humans = 1 + this.room.connectedSeats().length;
    this.set({ bots: Math.max(0, Math.min(6 - humans, Math.floor(n) || 0)) });
    this.lobby();
  }

  /** Host: set one bot's difficulty (bot 0 is the first bot). */
  setBotDifficulty(bot: number, level: BotLevel): void {
    if (this.room.role !== 'host' || bot < 0 || bot > 5 || !LEVELS.includes(level)) return;
    const difficulties = [...this.state.get().difficulties];
    difficulties[bot] = level;
    this.set({ difficulties });
  }

  /** Host: start the game with everyone in the room (plus bots). */
  start(seed?: number): Promise<void> | null {
    if (this.room.role !== 'host') return null;
    const roomSeats = [1, ...this.room.connectedSeats()];
    const bots = Math.min(this.state.get().bots, 6 - roomSeats.length);
    if (roomSeats.length + bots < 2) { this.set({ error: 'Wait for another player, or add a bot.' }); return null; }
    const base = this.deps.baseSettings();
    const chosen = this.state.get().difficulties;
    const difficulties: BotLevel[] = Array.from({ length: bots }, (_, i) => chosen[i] ?? 'medium');
    const settings: GameSettings = {
      ...base, players: roomSeats.length + bots, bots, difficulties,
      names: roomSeats.map(s => this.names.get(s) ?? 'Player ' + s),
    };
    this.host = new HostController(this.room, roomSeats, this.deps.memory);
    this.running = true;
    this.set({ phase: 'playing', status: '', error: '' });
    this.deps.show(this.host);
    return this.host.start(settings, seed);
  }

  // ---- messages

  private onData(data: unknown, from: number): void {
    if (this.room.role === 'host') {
      if (!isToHost(data)) return;
      if (data.k === 'name') { this.names.set(from, cleanName(data.name) || 'Player ' + from); this.lobby(); return; }
      this.host?.receive(data, from);
      return;
    }
    if (!isToPlayer(data) || !this.client) return;
    if (data.k === 'lobby') { this.set({ players: data.players, bots: data.bots }); return; }
    if (data.k === 'snap' && !this.running) {
      this.running = true;
      this.set({ phase: 'playing', status: '' });
      this.deps.show(this.client);
    }
    this.client.receive(data);
  }

  private async onAsk(q: AskMsg): Promise<string> {
    if (q.mode !== ASK_MODE || !this.client) return 'no';
    let decision;
    try { decision = JSON.parse(q.l1); } catch { return 'no'; }
    const answer = await this.client.askHere(decision);
    return JSON.stringify(answer);
  }

  private onPlayerLeft(roomSeat: number): void {
    if (this.host) {
      const seat = this.host.gameSeat(roomSeat);
      if (seat > 0) void this.host.leave(seat);
    }
    this.names.delete(roomSeat);
    this.lobby();
  }

  /** Host: tell everyone who's in the room. */
  private lobby(): void {
    if (this.room.role !== 'host') return;
    const players = [1, ...this.room.connectedSeats()].map(seat => ({ seat, name: this.names.get(seat) ?? 'Player ' + seat }));
    this.set({ players });
    if (!this.running) this.room.broadcastData({ k: 'lobby', players, bots: this.state.get().bots } satisfies ToPlayer);
  }

  /** The bots' difficulties from Settings, as a starting point the host can change in the lobby. */
  private startingLevels(): BotLevel[] {
    const base = this.deps.baseSettings().difficulties;
    return Array.from({ length: 6 }, (_, i) => (LEVELS.includes(base[i] as BotLevel) ? base[i] as BotLevel : 'medium'));
  }

  private reset(status: string): void {
    this.room.leave();
    this.running = false;
    this.host = null; this.client = null; this.names.clear();
    this.clearStill();
    this.state.set({ ...IDLE, phase: 'connecting', status });
  }

  private failed(): false {
    this.set({ phase: 'idle', status: '', error: this.room.errorMessage || 'Could not go online.' });
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
