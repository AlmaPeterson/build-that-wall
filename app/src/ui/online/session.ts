// An online session for the Online screen: quick match, host a room, join with a code, the lobby,
// starting the game (host) and following it (players). Any device can add guests: more people playing on
// that same device, who pass it between them (Pass'n'Play inside an online game).
import type { BotMemory, Difficulty, Ending, GameSettings } from '../../game';
import { OnlineRoom, cleanName, type AskMsg, type Connect } from '../../services/online';
import type { GameController } from '../controller';
import { createStore, type Store } from '../store';
import { OnlineClientController } from './client';
import { HostController } from './host';
import { ASK_MODE, MAX_SEATS, TURN_OK, isToHost, isToPlayer, type LobbyPlayer, type ToPlayer } from './messages';

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
  /** More people playing on this device (their names), as well as this device's own player. */
  guests: string[];
  bots: number;
  /** How the game ends (the host picks it in the lobby; players see it there). */
  ending: Ending;
  /** How many times the draw pile must run out (endings 2-4). */
  endingTimes: 1 | 2;
  /** Host: each bot's difficulty (bot k = difficulties[k]); 'random' picks one when the game starts. */
  difficulties: BotLevel[];
  status: string;
  error: string;
  /** "Still here?" is showing: when it runs out (Date.now() ms); 0 = not asked. */
  still: number;
  /** A message to show after being taken out of an online game (e.g. away too long); '' = none. */
  notice: string;
  /** "Leave the online game?" is showing (End Game, or the browser's Back button). */
  confirmLeave?: boolean;
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
  /** Where this device remembers the running game it's in, to get back into it (rejoin). */
  rejoinStore?: { load(): string; save(value: string | null): void };
  now?: () => number;
}

/** The online game this device was playing in (not as the host), to get back into it. */
export interface RejoinInfo {
  code: string;
  /** This device's id in that room: the host gives its seat back to it. */
  cid: string;
  /** When it left (Date.now() ms). */
  at: number;
  /** It left without meaning to (reload, closed page): go straight back in when the page opens again. */
  auto: boolean;
}

/** Back in automatically after a reload this soon; with the Rejoin button this soon. */
export const AUTO_REJOIN_MS = 10 * 60000;
export const REJOIN_MS = 60 * 60000;
export const REJOIN_FAILED = "Couldn't get back into that game. It may have ended.";

const IDLE: OnlineState = { phase: 'idle', role: '', code: '', seat: 1, players: [], guests: [], bots: 0, ending: 1, endingTimes: 1, difficulties: [], status: '', error: '', still: 0, notice: '' };
export const AWAY_NOTICE = "You didn't answer \"Still here?\" in time, so you've left the online game.";
const AUTO_JOIN_TRIES = 20, AUTO_JOIN_MS = 2000;

export class OnlineSession {
  readonly state: Store<OnlineState> = createStore<OnlineState>({ ...IDLE });
  private room: OnlineRoom;
  private host: HostController | null = null;
  private client: OnlineClientController | null = null;
  private names = new Map<number, string>();
  /** Host: the guests on each device (room seat); the host's own are in state.guests. */
  private guestsBy = new Map<number, string[]>();
  private running = false;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatchingEnd: (() => void) | null = null;

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
      onHostLost: () => { this.forget(); this.set({ phase: 'ended', error: 'The host left the game.' }); },
      onStatus: status => this.set({ status }),
      // Back after a dropped connection: anything sent meanwhile was missed, so catch up
      onReconnected: () => {
        if (this.room.role === 'client' && this.client) this.room.sendData(1, { k: 'resync' });
        else if (this.room.role === 'host') this.host?.resyncAll();
      },
      onStillAsk: msLeft => this.askedStill(msLeft),
      onDropped: () => this.away(),
      // Host: they're back; send them everything again
      onStillHere: seat => { for (const g of this.host?.gameSeats(seat) ?? []) this.host?.resyncSeat(g); },
      // Host: someone who left came back to their seat: they (and their guests) play again
      onRejoin: seat => { for (const g of this.host?.gameSeats(seat) ?? []) this.host?.playerBack(g); },
    }, this.deps.random);
  }

  // ---- getting into a room

  async hostRoom(max = 6): Promise<boolean> {
    this.forget();                                    // a different game now
    this.reset('Opening a room...');
    const code = await this.room.host({ max });
    if (!code) return this.failed();
    this.names.set(1, cleanName(this.deps.name()) || 'Player 1');
    this.set({ phase: 'lobby', role: 'host', code, seat: 1, status: '', difficulties: this.startingLevels(), ...this.startingEnding() });
    this.lobby();
    return true;
  }

  async join(code: string): Promise<boolean> {
    this.forget();                                    // a different game now
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
    this.forget();                                    // a different game now
    this.reset('Connecting to the online service...');
    const seat = await this.room.quick(max);
    if (seat <= 0) return this.failed();
    if (this.room.role === 'host') {
      this.names.set(1, cleanName(this.deps.name()) || 'Player 1');
      this.set({ phase: 'lobby', role: 'host', code: this.room.code, seat: 1, status: '', error: '', difficulties: this.startingLevels(), ...this.startingEnding() });
      this.lobby();
    } else this.joined(seat);
    return true;
  }

  private joined(seat: number): void {
    this.client = new OnlineClientController(msg => this.room.sendData(1, msg));
    this.set({ phase: 'lobby', role: 'client', code: this.room.code, seat, status: 'Waiting for the host to start...', error: '' });
    this.sendName();
  }

  /** Tell the host this device's player's name, and who else plays on it. */
  private sendName(): void {
    const seat = this.state.get().seat;
    this.room.sendData(1, { k: 'name', name: cleanName(this.deps.name()) || 'Player ' + seat, guests: this.state.get().guests });
  }

  // ---- more people on this device

  /** Add someone who plays on this device too (before the game starts). */
  addGuest(name: string): boolean {
    const st = this.state.get();
    if (st.phase !== 'lobby' || st.guests.length >= MAX_SEATS - 1 || st.players.length >= MAX_SEATS) return false;
    this.setGuests([...st.guests, cleanName(name) || 'Guest ' + (st.guests.length + 1)]);
    return true;
  }

  removeGuest(i: number): void {
    const st = this.state.get();
    if (st.phase === 'lobby') this.setGuests(st.guests.filter((_, k) => k !== i));
  }

  private setGuests(guests: string[]): void {
    this.set({ guests });
    if (this.room.role === 'host') { this.setBots(this.state.get().bots); return; }
    this.sendName();
  }

  /** In a room or a game: leaving it now affects the other players, so Back and End Game ask first. */
  get inRoom(): boolean { const p = this.state.get().phase; return p === 'lobby' || p === 'playing'; }

  /** Ask "Leave the online game?" (End Game, or the browser's Back button). */
  askLeave(): void { if (this.inRoom) this.set({ confirmLeave: true }); }
  keepPlaying(): void { this.set({ confirmLeave: false }); }

  /** Yes, leave: the others are told straight away (a bot plays this player's cards), and back to the menu. */
  confirmLeave(): void {
    this.set({ confirmLeave: false });
    this.remember(false);
    this.controller?.stop();
    this.leave();
    this.deps.home?.();
  }

  // ---- getting back into a game this device left

  /** The game this device left, if it may still be going (within `ms` of leaving). */
  rejoinable(ms = REJOIN_MS): RejoinInfo | null {
    if (this.state.get().phase !== 'idle') return null;
    let info: RejoinInfo | null = null;
    try { info = JSON.parse(this.deps.rejoinStore?.load() || 'null') as RejoinInfo | null; } catch { /* not saved right */ }
    if (!info || typeof info.code !== 'string' || typeof info.cid !== 'string' || !info.code || !info.cid) return null;
    return this.now() - (+info.at || 0) <= ms ? info : null;
  }

  /** Left without meaning to (a reload): go straight back in? */
  autoRejoinable(): boolean { return !!this.rejoinable(AUTO_REJOIN_MS)?.auto; }

  /** Go back into the game this device left: the host gives the same seat back and the bot stops playing it. */
  async rejoin(): Promise<boolean> {
    const info = this.rejoinable();
    if (!info) return false;
    this.reset('Getting you back into your game...');
    // Ready before the host's welcome: it sends everything again straight away, and the board shows once that arrives (onData)
    const client = new OnlineClientController(msg => this.room.sendData(1, msg));
    this.client = client;
    const seat = await this.room.join(info.code, undefined, info.cid);
    if (this.client !== client) return false;                          // the player gave up (Cancel)
    if (seat <= 0) {
      this.forget();
      this.room.leave();
      this.client = null;
      this.set({ phase: 'idle', status: '', error: REJOIN_FAILED });
      return false;
    }
    this.set({ role: 'client', code: info.code, seat, error: '', ...(this.running ? {} : { status: 'Catching up on the game...' }) });
    return true;
  }

  /** Not going back: forget the game this device left. */
  forget(): void { this.deps.rejoinStore?.save(null); }

  /** A player (not the host) in a running game: remember it, to get back in. auto: left without meaning to. */
  private remember(auto: boolean): void {
    if (this.room.role !== 'client' || !this.running || !this.client || this.client.state?.over) return;
    const info: RejoinInfo = { code: this.room.code, cid: this.room.clientId, at: this.now(), auto };
    this.deps.rejoinStore?.save(JSON.stringify(info));
  }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** Show the running game again (from the Online screen). */
  backToGame(): void {
    const c = this.controller;
    if (c && this.running) this.deps.show(c);
  }

  /** The page went into the background (another window or app) or came back. */
  pageVisible(visible: boolean): void { this.room.setAway(!visible); }

  /** The page is closing for good: say goodbye now, so nobody waits for us. */
  pageClosing(): void { this.remember(true); this.room.leave(); }

  leave(): void {
    this.room.leave();
    this.running = false;
    this.host = null; this.client = null; this.names.clear(); this.guestsBy.clear();
    this.clearStill();
    this.stopWatchingEnd?.(); this.stopWatchingEnd = null;
    this.state.set({ ...IDLE, guests: this.state.get().guests });   // the people on this device stay for next time
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
    this.remember(false);
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
    const humans = this.seatList().length;
    this.set({ bots: Math.max(0, Math.min(MAX_SEATS - humans, Math.floor(n) || 0)) });
    this.lobby();
  }

  /**
   * Host: everyone who will play, device by device (the host first), each device's player before their guests.
   * At most MAX_SEATS: guests who don't fit are left out.
   */
  private seatList(): LobbyPlayer[] {
    const list: LobbyPlayer[] = [];
    const devices = [1, ...this.room.connectedSeats()];
    for (const seat of devices) list.push({ seat, name: this.names.get(seat) ?? 'Player ' + seat });
    for (const seat of devices) {
      const guests = seat === 1 ? this.state.get().guests : this.guestsBy.get(seat) ?? [];
      for (const name of guests) if (list.length < MAX_SEATS) list.push({ seat, name, guest: true });
    }
    // Each device's people together, in device order
    return devices.flatMap(seat => list.filter(p => p.seat === seat));
  }

  /** Host: how the game ends, and how many times the deck must run out (endings 2-4). Everyone in the room sees it. */
  setEnding(ending: Ending, endingTimes: 1 | 2 = this.state.get().endingTimes): void {
    if (this.room.role !== 'host' || this.running || ![1, 2, 3, 4].includes(ending)) return;
    this.set({ ending, endingTimes: endingTimes === 2 ? 2 : 1 });
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
    const people = this.seatList();
    const roomSeats = people.map(p => p.seat);
    const bots = Math.min(this.state.get().bots, MAX_SEATS - roomSeats.length);
    if (roomSeats.length + bots < 2) { this.set({ error: 'Wait for another player, or add a bot.' }); return null; }
    const base = this.deps.baseSettings();
    const chosen = this.state.get().difficulties;
    const difficulties: BotLevel[] = Array.from({ length: bots }, (_, i) => chosen[i] ?? 'medium');
    const settings: GameSettings = {
      ...base, players: roomSeats.length + bots, bots, difficulties, ending: this.state.get().ending, endingTimes: this.state.get().endingTimes,
      names: people.map(p => p.name),
    };
    this.host = new HostController(this.room, roomSeats, this.deps.memory, true);
    this.running = true;
    this.set({ phase: 'playing', status: '', error: '' });
    this.deps.show(this.host);
    this.watchForEnd(this.host);
    return this.host.start(settings, seed);
  }

  // ---- messages

  private onData(data: unknown, from: number): void {
    if (this.room.role === 'host') {
      if (!isToHost(data)) return;
      if (data.k === 'name') {
        this.names.set(from, cleanName(data.name) || 'Player ' + from);
        if (!this.running) {
          const guests = Array.isArray(data.guests) ? data.guests.slice(0, MAX_SEATS - 1).map((g, i) => cleanName(String(g)) || 'Guest ' + (i + 1)) : [];
          this.guestsBy.set(from, guests);
          this.setBots(this.state.get().bots);
        }
        this.lobby();
        return;
      }
      this.host?.receive(data, from);
      return;
    }
    if (!isToPlayer(data) || !this.client) return;
    if (data.k === 'lobby') {
      const ending = ([1, 2, 3, 4] as const).find(n => n === data.ending) ?? this.state.get().ending;
      this.set({ players: data.players, bots: data.bots, ending, endingTimes: data.endingTimes === 2 ? 2 : 1 });
      return;
    }
    if (data.k === 'snap' && !this.running) {
      this.running = true;
      this.set({ phase: 'playing', status: '' });
      this.deps.show(this.client);
      this.watchForEnd(this.client);
    }
    this.client.receive(data);
  }

  private async onAsk(q: AskMsg): Promise<string> {
    if (q.mode !== ASK_MODE || !this.client) return 'no';
    let decision;
    try { decision = JSON.parse(q.l1); } catch { return 'no'; }
    if (decision?.kind === TURN_OK) { await this.client.askTurnOk(typeof decision.seat === 'number' ? decision.seat : undefined); return 'true'; }
    const answer = await this.client.askHere(decision);
    return JSON.stringify(answer);
  }

  private onPlayerLeft(roomSeat: number): void {
    for (const seat of this.host?.gameSeats(roomSeat) ?? []) void this.host!.playerLeft(seat);
    if (!this.running) { this.names.delete(roomSeat); this.guestsBy.delete(roomSeat); }
    this.lobby();
  }

  /** Host: tell everyone who's in the room. */
  private lobby(): void {
    if (this.room.role !== 'host') return;
    const players = this.seatList();
    this.set({ players });
    const { bots, ending, endingTimes } = this.state.get();
    if (!this.running) this.room.broadcastData({ k: 'lobby', players, bots, ending, endingTimes } satisfies ToPlayer);
  }

  /** How games end from Settings (the Play menu's More options), as a starting point the host can change in the lobby. */
  private startingEnding(): Pick<OnlineState, 'ending' | 'endingTimes'> {
    const base = this.deps.baseSettings();
    return { ending: ([1, 2, 3, 4] as const).find(n => n === base.ending) ?? 1, endingTimes: base.endingTimes === 2 ? 2 : 1 };
  }

  /** The bots' difficulties from Settings, as a starting point the host can change in the lobby. */
  private startingLevels(): BotLevel[] {
    const base = this.deps.baseSettings().difficulties;
    return Array.from({ length: 6 }, (_, i) => (LEVELS.includes(base[i] as BotLevel) ? base[i] as BotLevel : 'medium'));
  }

  private reset(status: string): void {
    this.room.leave();
    this.running = false;
    this.host = null; this.client = null; this.names.clear(); this.guestsBy.clear();
    this.clearStill();
    this.stopWatchingEnd?.(); this.stopWatchingEnd = null;
    // The people on this device stay for the next room
    this.state.set({ ...IDLE, phase: 'connecting', status, guests: this.state.get().guests });
  }

  /** The result screen may stay open, but this room is no longer a running game. */
  private finished(): void {
    if (!this.running) return;
    this.forget();
    this.running = false;
    this.set({ phase: 'ended', status: '' });
  }

  private watchForEnd(c: GameController): void {
    this.stopWatchingEnd?.();
    this.stopWatchingEnd = c.snapshot.subscribe(() => {
      if (c.state?.over) this.finished();
    });
  }

  private failed(): false {
    this.set({ phase: 'idle', status: '', error: this.room.errorMessage || 'Could not go online.' });
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
