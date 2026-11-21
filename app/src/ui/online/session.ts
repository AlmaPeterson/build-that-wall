// An online session for the Online screen: quick match, host a room, join with a code, the lobby,
// starting the game (host) and following it (players). Any device can add guests: more people playing on
// that same device, who pass it between them (Pass'n'Play inside an online game).
//
// If the host leaves a running game, the game goes on: the host keeps one other device (the heir) up to date
// with the whole game, and the heir takes over hosting while a bot plays the old host's cards. When the device
// that opened the room comes back, it gets its seat back and hosting is handed back to it.
import type { BotMemory, Difficulty, Ending, GameSettings } from '../../game';
import { OnlineRoom, cleanName, type AskMsg, type Connect } from '../../services/online';
import type { GameController, SavedGame } from '../controller';
import { createStore, type Store } from '../store';
import { OnlineClientController } from './client';
import { HostController } from './host';
import { ASK_MODE, MAX_SEATS, TURN_OK, isToHost, isToPlayer, type Backup, type LobbyPlayer, type ToPlayer } from './messages';

export type Phase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'ended';
export type BotLevel = Difficulty | 'random';
const LEVELS: readonly BotLevel[] = ['easy', 'medium', 'hard', 'insane', 'random'];

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
  /** This player is a Gold member (a ★ by their name). */
  gold?: () => boolean;
  /** Names given to the bots, bot 1 first ("Bot Sam"; '' = the usual name). */
  botNames?: () => string[];
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
  /** It was the host: another device takes over hosting, and gives it back when this one returns. */
  host?: boolean;
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
  /** Host: the devices whose player is a Gold member. */
  private golds = new Set<number>();
  /** Host: the guests on each device (room seat); the host's own are in state.guests. */
  private guestsBy = new Map<number, string[]>();
  private running = false;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWatchingEnd: (() => void) | null = null;
  /** The controller on the board now. */
  private showing: GameController | null = null;
  /** Host: the game as it was last saved, for the heir. */
  private lastSave: SavedGame | null = null;
  /** Host: the device the backups go to. */
  private heirCid = '';
  /** The device that opened the room: hosting goes back to it when it returns. */
  private originCid = '';
  /** Player: the host's latest backup (this device is the heir). */
  private backup: Backup | null = null;

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
      onRejoin: seat => this.onRejoin(seat),
      // The host left a running game: the heir takes over, and everyone waits for it
      onHostGone: () => { if (this.backup) void this.takeOver(this.backup); return this.running; },
      onNewHost: () => this.onNewHost(),
      onHandOverFailed: () => this.handOverFailed(),
      // This device was the host, dropped out, and another device took over meanwhile: come back in as a player
      onReplaced: () => { this.remember(true, true); void this.rejoin(); },
    }, this.deps.random);
  }

  // ---- getting into a room

  /** Open a private room. `code`: a Gold member's own room, with the same code every time. */
  async hostRoom(max = 6, code?: string): Promise<boolean> {
    this.forget();                                    // a different game now
    this.reset('Opening a room...');
    const opened = await this.room.host({ max, code });
    if (!opened) return this.failed();
    code = opened;
    this.names.set(1, cleanName(this.deps.name()) || 'Player 1');
    this.originCid = this.room.clientId;
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
      this.originCid = this.room.clientId;
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
    this.room.sendData(1, { k: 'name', name: cleanName(this.deps.name()) || 'Player ' + seat, guests: this.state.get().guests, gold: !!this.deps.gold?.() });
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
    // Right after the host left, the room is closed for a moment until another device takes over: the old host tries a few times
    let seat = 0;
    for (let i = 0; i < (info.host ? 3 : 1) && seat <= 0 && this.client === client; i++) {
      if (i) await (this.deps.wait ?? sleep)(2500);
      if (this.client === client) seat = await this.room.join(info.code, undefined, info.cid);
    }
    if (this.host) return true;                                         // we opened this room: hosting was handed straight back
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
  /** replaced: this device was the host and another device took over (the room no longer says we host it). */
  private remember(auto: boolean, replaced = false): void {
    const role = this.room.role, c = this.controller;
    if ((role !== 'client' && role !== 'host' && !replaced) || !this.running || !c || c.state?.over) return;
    const info: RejoinInfo = { code: this.room.code || this.state.get().code, cid: this.room.clientId, at: this.now(), auto };
    if (role === 'host' || replaced) info.host = true;
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
    this.host = null; this.client = null; this.names.clear(); this.golds.clear(); this.guestsBy.clear();
    this.showing = null; this.lastSave = null; this.heirCid = ''; this.originCid = ''; this.backup = null;
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
    for (const seat of devices) {
      const gold = seat === 1 ? !!this.deps.gold?.() : this.golds.has(seat);
      list.push({ seat, name: this.names.get(seat) ?? 'Player ' + seat, ...(gold ? { gold: true } : {}) });
    }
    for (const seat of devices) {
      const guests = seat === 1 ? this.state.get().guests : this.guestsBy.get(seat) ?? [];
      for (const name of guests) if (list.length < MAX_SEATS) list.push({ seat, name, guest: true });
    }
    // Each device's people together, in device order
    return devices.flatMap(seat => list.filter(p => p.seat === seat));
  }

  /** Host: how the game ends, and how many times the deck must run out (endings 2-4). Everyone in the room sees it. */
  setEnding(ending: Ending, endingTimes: 1 | 2 = this.state.get().endingTimes): void {
    if (this.room.role !== 'host' || this.running || ![1, 2, 3, 4, 5, 6].includes(ending)) return;
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
    // Insane bots are for a Gold host
    const difficulties: BotLevel[] = Array.from({ length: bots }, (_, i) => chosen[i] ?? 'medium').map(d => (d === 'insane' && !this.deps.gold?.() ? 'hard' : d));
    const settings: GameSettings = {
      ...base, players: roomSeats.length + bots, bots, difficulties, ending: this.state.get().ending, endingTimes: this.state.get().endingTimes,
      names: [...people.map(p => p.name), ...Array.from({ length: bots }, (_, k) => this.deps.botNames?.()[k] ?? '')],
      gold: people.map(p => !!p.gold && !p.guest),
    };
    this.host = this.newHost(roomSeats);
    this.running = true;
    this.set({ phase: 'playing', status: '', error: '' });
    this.display(this.host);
    return this.host.start(settings, seed);
  }

  /** Host: the game is over and everyone can play again in the same room. */
  canRematch(): boolean {
    const st = this.state.get();
    return this.room.role === 'host' && !this.running && st.phase === 'ended' && !st.error;
  }

  /** Host: a new game with everyone still in the room, the same bots and the same ending. */
  rematch(seed?: number): Promise<void> | null {
    if (!this.canRematch()) return null;
    this.room.broadcastData({ k: 'rematch' } satisfies ToPlayer);
    this.showing = null; this.lastSave = null; this.backup = null;
    return this.start(seed);
  }

  /** Show a controller on the board (once). */
  private display(c: GameController): void {
    if (this.showing === c) return;
    this.showing = c;
    this.deps.show(c);
    this.watchForEnd(c);
  }

  // ---- the host leaving: another device carries on hosting

  private newHost(roomSeats: number[]): HostController {
    return new HostController(this.room, roomSeats, this.deps.memory, true, saved => { this.lastSave = saved; this.sendBackup(); });
  }

  /** The device that takes over if the host leaves: the one that opened the room, if it's here, else the lowest seat. */
  private heir(): { cid: string; seat: number } | null {
    const others = this.room.devices().filter(d => d.seat !== 1);
    return others.find(d => d.cid === this.originCid) ?? others[0] ?? null;
  }

  private backupFor(takeover = false): Backup | null {
    if (!this.host || !this.lastSave) return null;
    return {
      k: 'backup', saved: this.lastSave, roomSeats: this.host.seatMap, devices: this.room.devices(),
      formers: this.room.formerDevices(), origin: this.originCid, ...(takeover ? { takeover: true } : {}),
    };
  }

  /** Host: keep the heir up to date (and tell a former heir it isn't any more). */
  private sendBackup(): void {
    if (this.room.role !== 'host' || !this.host || this.host.state?.over) return;
    const heir = this.heir();
    if (this.heirCid && heir?.cid !== this.heirCid) {
      const old = this.room.devices().find(d => d.cid === this.heirCid);
      if (old) this.room.sendData(old.seat, { k: 'nobackup' } satisfies ToPlayer);
    }
    this.heirCid = heir?.cid ?? '';
    const b = this.backupFor();
    if (heir && b) this.room.sendData(heir.seat, b);
  }

  /**
   * Become the host, carrying on the game in `b`. This device takes seat 1 and the old host takes this device's
   * old seat. If the old host left, a bot plays their cards until they come back.
   */
  private async takeOver(b: Backup): Promise<void> {
    if (this.host || this.room.role !== 'client') return;
    this.backup = null;
    const mine = this.room.seat, me = this.room.clientId;
    const oldHost = b.devices.find(d => d.seat === 1)?.cid ?? '';
    const swap = (r: number) => (r === 1 ? mine : r === mine ? 1 : r);
    const roomSeats = b.roomSeats.map(swap);
    const devices = b.devices.filter(d => d.cid !== me && d.cid !== oldHost);
    const formers = [...b.formers];
    if (b.takeover) devices.push({ cid: oldHost, seat: mine });        // handed to us: they're still here, as a player
    else formers.push({ cid: oldHost, seat: mine });                    // they left: they can come back to that seat
    this.originCid = b.origin;
    this.client = null;
    await this.room.becomeHost(devices, formers);
    const saved = structuredClone(b.saved);
    // The old host's seats (and their guests'): a bot plays them while they're away
    const away = b.takeover ? [] : roomSeats.flatMap((r, seat) => (r === mine && !saved.state.seats[seat]?.bot ? [seat] : []));
    // Coming back to host: our own seats are ours again (the backup was saved while a bot played them)
    if (b.takeover) {
      b.roomSeats.forEach((r, seat) => {
        const p = saved.state.seats[seat];
        if (r !== mine || !p?.standIn) return;
        p.bot = null; p.standIn = false;
        saved.events.push({ type: 'announce', seat, text: p.name + ' is back and playing again.' });
      });
    }
    if (saved.at === 'turn') {
      for (const seat of away) {
        const p = saved.state.seats[seat]!;
        p.bot = 'medium'; p.standIn = true;
        saved.events.push({ type: 'announce', seat, text: p.name + ' left the game, so a bot is playing for them.' });
      }
    }
    this.host = this.newHost(roomSeats);
    this.lastSave = saved;
    this.running = true;
    this.set({ role: 'host', seat: 1, phase: 'playing', status: '', error: '' });
    this.display(this.host);
    void this.host.resume(saved);
    if (saved.at === 'move') for (const seat of away) void this.host.playerLeft(seat);
    this.host.resyncAll();
    this.sendBackup();
  }

  /** Player: another device hosts the game now. Anything the old host asked is void; catch up with the new one. */
  private onNewHost(): void {
    this.backup = null;
    if (this.host) {
      // We handed hosting over: this device is a player now
      this.host.stop();
      this.host = null; this.lastSave = null; this.heirCid = '';
      this.client = new OnlineClientController(msg => this.room.sendData(1, msg));
      this.set({ role: 'client', seat: this.room.seat });
    } else this.client?.hostChanged();
    this.room.sendData(1, { k: 'resync' });
  }

  /** Host: a device came back to its seat. If it's the one that opened the room, it hosts again. */
  private onRejoin(seat: number): void {
    for (const g of this.host?.gameSeats(seat) ?? []) this.host?.playerBack(g);
    const back = this.room.devices().find(d => d.seat === seat);
    if (back && back.cid === this.originCid && back.cid !== this.room.clientId) void this.handBack(back.seat, back.cid);
    else this.sendBackup();
  }

  private async handBack(seat: number, cid: string): Promise<void> {
    const b = this.backupFor(true);
    if (!b || !this.host) return;
    await this.room.handOver(cid, seat);
    this.room.sendData(seat, b);
    this.host.stop();                     // the game carries on, from this backup, on their device
  }

  /** They didn't take over in time: carry on hosting from where we stopped. */
  private handOverFailed(): void {
    const saved = this.lastSave;
    if (!this.host || !saved) return;
    const roomSeats = this.host.seatMap;
    this.host = this.newHost(roomSeats);
    this.display(this.host);
    void this.host.resume(structuredClone(saved));
    this.host.resyncAll();
    this.sendBackup();
  }

  // ---- messages

  private onData(data: unknown, from: number): void {
    if (this.room.role === 'host') {
      if (!isToHost(data)) return;
      if (data.k === 'name') {
        this.names.set(from, cleanName(data.name) || 'Player ' + from);
        if (data.gold === true) this.golds.add(from); else this.golds.delete(from);
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
    if (data.k === 'backup') { if (data.takeover) void this.takeOver(data); else this.backup = data; return; }
    if (data.k === 'nobackup') { this.backup = null; return; }
    if (data.k === 'rematch') {
      // A new game in the same room: a fresh board, shown when its first snapshot arrives
      this.client = new OnlineClientController(msg => this.room.sendData(1, msg));
      this.showing = null; this.backup = null;
      this.set({ phase: 'lobby', status: 'The host started a rematch...', error: '' });
      return;
    }
    if (data.k === 'lobby') {
      const ending = ([1, 2, 3, 4, 5, 6] as const).find(n => n === data.ending) ?? this.state.get().ending;
      this.set({ players: data.players, bots: data.bots, ending, endingTimes: data.endingTimes === 2 ? 2 : 1 });
      return;
    }
    if (data.k === 'snap' && this.showing !== this.client) {
      this.running = true;
      this.set({ phase: 'playing', status: '' });
      this.display(this.client);
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
    this.sendBackup();                    // the heir may have been the one who left
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
    return { ending: ([1, 2, 3, 4, 5, 6] as const).find(n => n === base.ending) ?? 1, endingTimes: base.endingTimes === 2 ? 2 : 1 };
  }

  /** The bots' difficulties from Settings, as a starting point the host can change in the lobby. */
  private startingLevels(): BotLevel[] {
    const base = this.deps.baseSettings().difficulties;
    return Array.from({ length: 6 }, (_, i) => (LEVELS.includes(base[i] as BotLevel) ? base[i] as BotLevel : 'medium'));
  }

  private reset(status: string): void {
    this.room.leave();
    this.running = false;
    this.host = null; this.client = null; this.names.clear(); this.golds.clear(); this.guestsBy.clear();
    this.showing = null; this.lastSave = null; this.heirCid = ''; this.originCid = ''; this.backup = null;
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
