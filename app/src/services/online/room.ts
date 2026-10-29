// ---- online play: host/join with a room code, through a public MQTT relay.
// The host's device is the hub: players talk to the host, and the host relays to everyone.
// Whoever's turn it is sends the whole game state whenever it changes.
import {
  ALL_ROOMS, codeFromTopic, parseMsg, parseRoomInfo, topics,
  type AskMsg, type DownMsg, type GameMsg, type RoomInfo,
} from './protocol';
import type { Connect, Transport } from './transport';

/** What the room needs from the game. The game core doesn't know about rooms. */
export interface GameHooks {
  /** The whole shared state, JSON-serialisable. */
  getState(): unknown;
  /** Replace the shared state with one from another device. */
  applyState(state: unknown): void;
  isRunning(): boolean;
  /** Whose turn it is (seat 1-6, bots included). */
  turn(): number;
  /** The seat whose device plays the current turn: bots and empty seats are played by the host (see seatOwner). */
  turnOwner(): number;
  /**
   * false: don't share the whole state every tick. The TypeScript game's host runs the game and sends
   * each player only what they may see, with sendData. Default true (the PenguinMod way).
   */
  autoSync?: boolean;
}

/** Things that happen to this device. All optional. */
export interface RoomEvents {
  /** This device's seat changed (1 = host or offline, 0 = spectator). */
  onSeat?(seat: number): void;
  /** Another device just passed the turn to this one. */
  onMyTurn?(): void;
  /** Another device asked this one to end its turn. */
  onEndTurn?(): void;
  /** A player left mid-game (host: from its own heartbeat check; players: told by the host). */
  onPlayerLeft?(seat: number): void;
  /** The host left or stopped answering. wasPlaying: a game was running. */
  onHostLost?(wasPlaying: boolean): void;
  /** Another player asks this device a question; resolve with the answer. */
  onAsk?(ask: AskMsg): Promise<string>;
  /** Progress text for the player ("Looking for an online game..."). */
  onStatus?(text: string): void;
  /** A data message (see sendData). fromSeat: the sender (1 = the host). */
  onData?(data: unknown, fromSeat: number): void;
  /** Host: a player joined the room (before the game starts). */
  onJoin?(seat: number): void;
  /** The connection dropped and came back: messages may have been missed meanwhile. */
  onReconnected?(): void;
  /** The host hasn't heard from this device: show "Still here?" (msLeft to answer, then it's out). */
  onStillAsk?(msLeft: number): void;
  /** The host gave up on this device (no "Still here" in time): it has left the game. */
  onDropped?(): void;
  /** Host: a player said "Still here"; their seat was kept (send them everything again). */
  onStillHere?(seat: number): void;
}

export type Role = '' | 'host' | 'client';

export interface HostOptions {
  /** 2 to 6, default 6 */
  max?: number;
  /** Gold rooms: late or extra people can watch */
  spectators?: boolean;
  /** Listed for quick match */
  world?: boolean;
}

export interface AskQuestion {
  l1: string;
  l2: string;
  l3: string;
  card: number;
  mode: string;
}

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // no I, L, O, 0 or 1: easy to read out
const TICK_MS = 120;
const BEAT_MS = 4000;
const GONE_MS = 30000;            // no heartbeat for this long: the player or host has gone
// A page in the background said so first: browsers barely run its timers (Chrome: once a minute after
// 5 minutes; phones freeze it), so its heartbeats stop. Wait this long before deciding it's gone.
const AWAY_GONE_MS = 10 * 60000;
const RECONNECT_MS = 3000;        // a dropped connection: try again this often...
const RECONNECT_TRIES = 20;       // ...this many times (a page in the background waits until it's back)
const ROOM_WAIT_MS = 2500;
const ROOM_STALE_MS = 40000;
const JOIN_WAIT_MS = 9000;
const SCAN_MS = 2000;
const QUICK_FRESH_MS = 30000;
const ASK_TIMEOUT_MS = 45000;
// A player who would count as gone is asked "Still here?" first: this long on their screen...
export const STILL_MS = 60000;
// ...plus this long for a slow or frozen device, before the host gives up and marks them as left
export const STILL_GRACE_MS = 20000;
// Quick match: a room whose host doesn't welcome us this fast is probably left over; try the next one
const QUICK_JOIN_WAIT_MS = 4000;

/** Is this retained room info from a host that's still there? (A host in the background updates it rarely.) */
export function roomAlive(info: RoomInfo, now: number, fresh: number): boolean {
  return now - (info.ts || 0) <= (info.away ? AWAY_GONE_MS : fresh);
}

const ERRORS: Record<string, string> = {
  'peer-unavailable': 'No game with that code is open.',
  network: 'Could not reach the online service (check your internet).',
  'server-error': 'The online service is busy. Try again.',
  'socket-error': 'The online service is busy. Try again.',
  'unavailable-id': 'That room code is already in use.',
  'browser-incompatible': 'This browser cannot play online.',
  timeout: 'The other player did not answer in time.',
  found: 'Found a game but could not connect (your network may block online play).',
  hostleft: 'The host left the game.',
  load: 'Could not load the online library (check internet).',
};

/**
 * The seat whose device plays turn `turn`: bots (the last `ai` seats) and seats whose player
 * left are played by the host (seat 1). leftSeats[i] is 1 when seat i+1's player left.
 */
export function seatOwner(turn: number, players: number, ai: number, leftSeats: ReadonlyArray<number | string>): number {
  const t = +turn || 0;
  if (+(leftSeats[t - 1] ?? 0) === 1) return 1;
  return t > (+players || 0) - (+ai || 0) ? 1 : t;
}

/** A player name: control characters become spaces, at most 20 characters, trimmed. */
export function cleanName(text: string): string {
  const chars = Array.from(String(text)).map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim();
  return Array.from(chars).slice(0, 20).join('').trim();
}

function randomCode(random: () => number, prefix = ''): string {
  let code = prefix;
  for (let i = 0; i < 5; i++) code += LETTERS[Math.floor(random() * LETTERS.length)];
  return code;
}

export class OnlineRoom {
  private transport: Transport | null = null;
  private _role: Role = '';
  private _code = '';
  private _seat = 1;
  private _err = '';
  private max = 6;
  private spectators = false;
  private world = false;
  private cid = '';
  private conns = new Map<number, { cid: string }>();     // host: seat -> player
  private cid2seat = new Map<string, number>();
  private seen = new Map<number, number>();               // host: seat -> last heard from
  private away = new Set<number>();                       // host: seats whose page is in the background
  private stillAsked = new Map<number, number>();         // host: seat -> when it was asked "Still here?"
  private hostAway = false;                               // player: the host's page is in the background
  private myAway = false;                                 // this page is in the background
  private reconnecting = false;
  private backWaiter: (() => void) | null = null;         // a reconnect waiting for this page to come back
  private lastSeen = 0;                                   // player: last heard from the host
  private last = '';                                      // the state we last sent or got
  private was = false;                                    // it was our turn on the last tick
  private joining = false;
  private askId = 0;
  private asks = new Map<string, (answer: string) => void>();
  private scan: Map<string, RoomInfo> | null = null;
  private roomWait: ((info: RoomInfo | null) => void) | null = null;
  private joinDone: ((seat: number) => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly connectTransport: Connect,
    private readonly game: GameHooks,
    private readonly events: RoomEvents = {},
    private readonly random: () => number = Math.random,
  ) {}

  get role(): Role { return this._role; }
  get seat(): number { return this._seat; }
  get code(): string { return this._code; }
  /** Last problem code, e.g. "timeout" ("" = none). */
  get error(): string { return this._err; }
  /** The last problem in words for the player. */
  get errorMessage(): string {
    const e = this._err;
    return ERRORS[e] ?? (e ? 'Online problem: ' + e : '');
  }
  /** Players connected, the host included. */
  get count(): number {
    return this._role === 'host' ? 1 + this.conns.size : this._role ? 1 : 0;
  }

  /** Opens a room. Resolves the room code, or "" if the relay couldn't be reached. */
  async host(opts: HostOptions = {}): Promise<string> {
    // NOTE: the PenguinMod "host ... code [CODE]" block accepted a wanted code, but the MQTT version
    // always ignored it and made a random one. Kept that way.
    this.leave();
    if (!(await this.connect())) return '';
    this.openAsHost(randomCode(this.random), opts.max, !!opts.spectators, !!opts.world);
    await this.sub(topics(this._code).up);
    this.roomInfo();
    this.startTimers();
    return this._code;
  }

  /** Joins a room. Resolves the seat (2-6), -1 for a spectator, or 0 if it failed (see error). */
  async join(code: string, wait = JOIN_WAIT_MS): Promise<number> {
    this.leave();
    const clean = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) return 0;
    if (!(await this.connect())) return 0;
    return this.joinCode(clean, wait);
  }

  /** Quick match: join the fullest open world room, or open one if none is free. Resolves the seat. */
  async quick(max = 6): Promise<number> {
    this.leave();
    this.events.onStatus?.('Connecting to the online service...');
    if (!(await this.connect())) return 0;
    this.events.onStatus?.('Looking for an online game...');
    this.scan = new Map();
    await this.sub(ALL_ROOMS);
    await new Promise((r) => setTimeout(r, SCAN_MS));
    this.unsub(ALL_ROOMS);
    const now = Date.now();
    // Rooms left over by a host that's gone (closed without leaving): clear them so nobody tries them again
    for (const [code, i] of this.scan) if (i && !roomAlive(i, now, ROOM_STALE_MS)) this.clearRoom(code);
    const rooms = [...this.scan.entries()]
      .filter(([, i]) => i && i.world && i.open && !i.running && i.players < i.max && roomAlive(i, now, QUICK_FRESH_MS))
      .sort((x, y) => y[1].players - x[1].players);
    this.scan = null;
    for (const [code] of rooms) {
      this.events.onStatus?.('Joining an online game...');
      const seat = await this.joinCode(code, QUICK_JOIN_WAIT_MS);
      if (seat > 0) return seat;
    }
    // nobody waiting: open a world room on the same connection
    // NOTE: a failed join above leaves its error (e.g. "timeout") set even though hosting worked.
    this.openAsHost(randomCode(this.random, 'W'), max, false, true);
    await this.sub(topics(this._code).up);
    this.roomInfo();
    this.startTimers();
    return 1;
  }

  leave(): void {
    const tr = this.transport;
    if (tr) {
      const t = topics(this._code);
      if (this._role === 'host') { tr.publish(t.room, '', true); this.pubTo(tr, t.down, { t: 'end' }); }
      else if (this._role === 'client') this.pubTo(tr, t.up, { t: 'bye', cid: this.cid });
      this.transport = null;
      setTimeout(() => tr.end(), 300);     // let the goodbye go out first
    }
    this._role = ''; this._code = ''; this._seat = 1; this.was = false; this.last = '';
    this.conns.clear(); this.cid2seat.clear(); this.seen.clear(); this.away.clear(); this.stillAsked.clear(); this.joining = false;
    this.hostAway = false;
    this.stopTimers();
    this.backWaiter?.();
    this.events.onSeat?.(1);
  }

  /**
   * This page went into the background (true) or came back (false). The others are told, so they wait
   * much longer before deciding it has gone; coming back reconnects if the connection dropped meanwhile.
   */
  setAway(away: boolean): void {
    if (this.myAway === away) return;
    this.myAway = away;
    if (!this._role) return;
    const t = topics(this._code);
    if (this._role === 'host') { this.pub(t.down, { t: away ? 'away' : 'back' }); this.roomInfo(); }
    else this.pub(t.up, { t: away ? 'away' : 'back', cid: this.cid });
    if (away) return;
    const w = this.backWaiter;
    this.backWaiter = null;
    if (w) { w(); return; }                              // a reconnect was waiting for us
    // Silent for too long, or the connection is gone: the connection most likely died while we were away
    const dead = !this.transport || this.transport.connected?.() === false
      || (this._role === 'client' && Date.now() - this.lastSeen > GONE_MS);
    if (dead) { this.dropConnection(); void this.reconnect(); } else this.beat();
  }

  /** Ends the current turn, on whichever device plays it. */
  endTurn(): void {
    if (!this._role) return;
    const to = this.game.turnOwner();
    if (to === this._seat) { this.events.onEndTurn?.(); return; }
    this.send({ t: 'endturn', to });
  }

  /** Asks another seat's device a question. Resolves its answer, or "no" if it can't answer. */
  ask(seat: number, q: AskQuestion): Promise<string> {
    if (!this._role) return Promise.resolve('no');
    const id = ++this.askId + '-' + this._seat;
    return new Promise((res) => {
      this.asks.set(id, res);
      const m: AskMsg = { t: 'ask', to: +seat, from: this._seat, id, l1: String(q.l1), l2: String(q.l2), l3: String(q.l3), card: +q.card || 0, mode: String(q.mode) };
      if (this._role === 'host') {
        if (this.conns.has(m.to)) this.pub(topics(this._code).down, m);
        else { this.asks.delete(id); res('no'); return; }
      } else this.send(m);
      setTimeout(() => { if (this.asks.has(id)) { this.asks.delete(id); res('no'); } }, ASK_TIMEOUT_MS);
    });
  }

  /** Host: the seats of the players connected now (not the host's own seat 1), in seat order. */
  connectedSeats(): number[] {
    return this._role === 'host' ? [...this.conns.keys()].sort((a, b) => a - b) : [];
  }

  /**
   * Send data to one seat. Host: to that player's own topic (only they get it), or seat 1 = this device.
   * Player: to the host (seat 1). Returns false when there's no one to send to.
   */
  sendData(seat: number, data: unknown): boolean {
    if (!this._role) return false;
    const msg: GameMsg = { t: 'x', to: seat, from: this._seat, data };
    if (this._role === 'client') { this.send(msg); return true; }
    if (seat === 1) { this.events.onData?.(data, 1); return true; }
    const c = this.conns.get(seat);
    if (!c) return false;
    this.pub(topics(this._code).client(c.cid), msg);
    return true;
  }

  /** Host: send data to every connected player at once (for things everyone may see). */
  broadcastData(data: unknown): void {
    if (this._role === 'host') this.pub(topics(this._code).down, { t: 'x', to: 0, from: 1, data });
  }

  // ---- connection

  private async connect(): Promise<boolean> {
    let tr: Transport | null;
    try { tr = await this.connectTransport(); } catch { this._err = 'load'; return false; }
    if (!tr) { this._err = 'network'; return false; }
    this.transport = tr;
    tr.onMessage((topic, payload) => { if (this.transport === tr) this.handle(topic, payload); });
    tr.onClose(() => { if (this.transport === tr) { this.dropConnection(); void this.reconnect(); } });
    return true;
  }

  private dropConnection(): void {
    const tr = this.transport;
    this.transport = null;
    if (tr) try { tr.end(); } catch { /* already closed */ }
  }

  /** The connection dropped: connect again and pick up where we were (same room, same seat). */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || !this._role) return;
    this.reconnecting = true;
    const role = this._role, code = this._code;
    const still = () => this._role === role && this._code === code;
    try {
      for (let i = 0; i < RECONNECT_TRIES && still(); i++) {
        // In the background a phone may not even have a network: a player waits until the page is back.
        // The host keeps trying, or joiners would find its room dead and open their own instead.
        while (this.myAway && role === 'client' && still()) await new Promise<void>(r => { this.backWaiter = r; });
        if (!still()) return;
        if (await this.connect()) {
          if (!still()) { this.dropConnection(); return; }
          await this.rejoin();
          this.events.onReconnected?.();
          return;
        }
        await new Promise(r => setTimeout(r, RECONNECT_MS));
      }
      if (still() && role === 'client') this.lost();
    } finally {
      this.reconnecting = false;
    }
  }

  /** After reconnecting: listen again, and say hello (the host knows us by our id and gives the same seat back). */
  private async rejoin(): Promise<void> {
    const t = topics(this._code);
    if (this._role === 'host') {
      await this.sub(t.up);
      const now = Date.now();
      for (const s of this.seen.keys()) this.seen.set(s, now);      // we were the one who couldn't hear them
      this.roomInfo();
      this.pub(t.down, { t: this.myAway ? 'away' : 'hb' });
    } else {
      await this.sub(t.down); await this.sub(t.client(this.cid));
      this.lastSeen = Date.now();
      this.pub(t.up, { t: 'hello', cid: this.cid });
    }
  }

  private pubTo(tr: Transport, topic: string, msg: object | string, retain?: boolean): void {
    tr.publish(topic, typeof msg === 'string' ? msg : JSON.stringify(msg), retain);
  }
  private pub(topic: string, msg: object | string, retain?: boolean): void {
    if (this.transport) this.pubTo(this.transport, topic, msg, retain);
  }
  private sub(topic: string): Promise<void> {
    return this.transport ? this.transport.subscribe(topic) : Promise.resolve();
  }
  private unsub(topic: string): void {
    this.transport?.unsubscribe(topic);
  }

  /** Host: to everyone (but the seat it came from). Player: to the host. */
  private send(msg: GameMsg, exceptSeat?: number): void {
    const t = topics(this._code);
    if (this._role === 'host') this.pub(t.down, exceptSeat !== undefined ? { ...msg, _except: exceptSeat } : { ...msg });
    else if (this._role === 'client') this.pub(t.up, { ...msg, cid: this.cid });
  }

  private openAsHost(code: string, max: number | undefined, spectators: boolean, world: boolean): void {
    this._code = code; this._role = 'host'; this._seat = 1;
    this.max = Math.max(2, Math.min(6, +(max ?? 6) || 6));
    this.spectators = spectators; this.world = world;
    this.conns.clear(); this.cid2seat.clear(); this.seen.clear();
    this.events.onSeat?.(1);
  }

  private async joinCode(code: string, wait: number): Promise<number> {
    this._code = code; this.cid = 'c' + this.random().toString(36).slice(2, 12); this._err = '';
    const t = topics(code);
    const info = await new Promise<RoomInfo | null>((res) => {
      this.roomWait = res;
      void this.sub(t.room);
      setTimeout(() => res(null), ROOM_WAIT_MS);
    });
    this.roomWait = null; this.unsub(t.room);
    if (!info || !info.open || !roomAlive(info, Date.now(), ROOM_STALE_MS)) {
      if (info && info.open) this.clearRoom(code);         // left over by a host that's gone
      this._err = 'peer-unavailable'; return 0;
    }
    await this.sub(t.down); await this.sub(t.client(this.cid));
    this.joining = true;
    const seat = await new Promise<number>((res) => {
      this.joinDone = (s) => { this.joinDone = null; res(s); };
      this.pub(t.up, { t: 'hello', cid: this.cid });
      setTimeout(() => { if (this.joinDone) { this._err = 'timeout'; this.joinDone = null; res(0); } }, wait);
    });
    this.joining = false;
    if (seat !== 0) { this._role = 'client'; this.lastSeen = Date.now(); this.startTimers(); return seat; }
    this.unsub(t.down); this.unsub(t.client(this.cid));
    return 0;
  }

  // ---- incoming

  private handle(topic: string, payload: string): void {
    if (topic.endsWith('/room')) {
      const code = codeFromTopic(topic);
      const info = parseRoomInfo(payload);
      if (this.scan) { if (info) this.scan.set(code, info); else this.scan.delete(code); }
      if (this.roomWait && code === this._code) this.roomWait(info);
      return;
    }
    const d = parseMsg(payload);
    if (!d) return;
    this.lastSeen = Date.now();
    const t = topics(this._code);
    if (this._role === 'host' && topic === t.up) {
      if (!('cid' in d) || typeof d.cid !== 'string') return;
      if (d.t === 'hello') { this.hostHello(d.cid); return; }
      const s = this.cid2seat.get(d.cid);
      if (d.t === 'bye') { if (s) this.gone(s); return; }
      if (!s) return;
      this.seen.set(s, Date.now());
      if (d.t === 'hb') return;
      if (d.t === 'away') { this.away.add(s); return; }
      if (d.t === 'back') { this.away.delete(s); this.askStill(s); return; }   // asked while it was away: ask now
      if (d.t === 'here') {
        this.away.delete(s);
        if (this.stillAsked.delete(s)) this.events.onStillHere?.(s);
        return;
      }
      this.onMsg(d as DownMsg, s);
      return;
    }
    if (this._role === 'client' || this.joining) {
      if (d.t === 'hb') return;
      if (d.t === 'away') { this.hostAway = true; return; }
      if (d.t === 'back') { this.hostAway = false; return; }
      if (d.t === 'end') { this.lost(); return; }
      if (d.t === 'still') { if (this._role === 'client') this.events.onStillAsk?.(Math.max(0, +d.left || 0)); return; }
      if (d.t === 'dropped') { if (this._role === 'client') { this._role = ''; this.stopTimers(); this.events.onDropped?.(); } return; }
      if ('_except' in d && d._except !== undefined && d._except === this._seat) return;
      this.onMsg(d as DownMsg, 1);
    }
  }

  private hostHello(cid: string): void {
    const to = topics(this._code).client(cid);
    const known = this.cid2seat.get(cid);
    if (known) {
      this.pub(to, { t: 'welcome', seat: known });
      this.askStill(known);                               // reconnected while asked "Still here?"
      return;
    }
    let seat = 0;
    for (let s = 2; s <= this.max; s++) if (!this.conns.has(s)) { seat = s; break; }
    if (!seat || this.game.isRunning()) {
      if (this.spectators) {
        this.pub(to, { t: 'welcome', seat: 0, spectator: true });
        this.pub(to, { t: 'state', data: this.game.getState(), from: 1 });
      } else this.pub(to, { t: 'full' });
      return;
    }
    this.conns.set(seat, { cid }); this.cid2seat.set(cid, seat); this.seen.set(seat, Date.now());
    this.pub(to, { t: 'welcome', seat });
    this.roomInfo();
    this.events.onJoin?.(seat);
  }

  private onMsg(d: DownMsg, fromSeat: number): void {
    const host = this._role === 'host';
    if (host && fromSeat !== 1) {                        // host relays everything from players
      if (d.t === 'state') this.send(d, fromSeat);
      if ((d.t === 'ask' || d.t === 'answer') && d.to !== 1 && this.conns.has(d.to)) this.pub(topics(this._code).down, d);
    }
    switch (d.t) {
      case 'welcome':
        // Reconnected, but the host had already let us go (the game went on without us)
        if (!this.joinDone && this._role === 'client' && d.spectator) { this.lost(); break; }
        this._seat = d.seat; this.events.onSeat?.(d.seat);
        this.joinDone?.(d.spectator ? -1 : d.seat);
        break;
      case 'full':
        if (!this.joinDone && this._role === 'client') { this.lost(); break; }
        this.joinDone?.(0);
        break;
      case 'state':
        this.applyIncoming(d.data);
        break;
      case 'ask':
        if (d.to === this._seat) this.answerAsk(d);
        break;
      case 'answer': {
        const done = d.to === this._seat ? this.asks.get(d.id) : undefined;
        if (done) { done(d.value); this.asks.delete(d.id); }
        break;
      }
      case 'endturn':
        if (host && d.to !== 1) this.send(d);
        else if (d.to === this._seat) this.events.onEndTurn?.();
        break;
      case 'playerleft':
        if (this._role === 'client') this.events.onPlayerLeft?.(d.seat);
        break;
      case 'x':
        if (d.to === 0 || d.to === this._seat) this.events.onData?.(d.data, fromSeat);
        break;
    }
  }

  private applyIncoming(state: unknown): void {
    const prevTurn = this.game.turn(), prevOwner = this.game.turnOwner();
    this.game.applyState(state);
    this.last = JSON.stringify(this.game.getState());      // don't echo it back
    const turn = this.game.turn();
    if (this.game.isRunning() && prevOwner !== this._seat && this.game.turnOwner() === this._seat && String(prevTurn) !== String(turn)) {
      this.events.onMyTurn?.();
    }
  }

  private answerAsk(q: AskMsg): void {
    if (!this.events.onAsk) return;                        // nobody to answer: the asker times out with "no"
    void this.events.onAsk(q).then((value) => {
      if (!this._role) return;
      const m: GameMsg = { t: 'answer', to: q.from, id: q.id, value: String(value) };
      if (this._role === 'host') { if (this.conns.has(q.from)) this.pub(topics(this._code).down, m); }
      else this.send(m);
    });
  }

  // ---- players coming and going

  /** A player said goodbye or stopped answering. */
  private gone(seat: number): void {
    if (this.game.isRunning()) this.playerLeft(seat);
    else this.drop(seat);
  }

  /** Host: ask one player's device "Still here?" (on its own topic), if it's being asked. */
  private askStill(seat: number): void {
    const c = this.conns.get(seat), asked = this.stillAsked.get(seat);
    if (!c || asked === undefined) return;
    this.pub(topics(this._code).client(c.cid), { t: 'still', left: Math.max(0, STILL_MS - (Date.now() - asked)) });
  }

  private tellDropped(seat: number): void {
    const c = this.conns.get(seat);
    if (c) this.pub(topics(this._code).client(c.cid), { t: 'dropped' });
  }

  /** Player: "Still here" was clicked. */
  stillHere(): void {
    if (this._role !== 'client') return;
    this.lastSeen = Date.now();
    this.pub(topics(this._code).up, { t: 'here', cid: this.cid });
  }

  private playerLeft(seat: number): void {
    this.drop(seat, false);
    this.pub(topics(this._code).down, { t: 'playerleft', seat });
    this.events.onPlayerLeft?.(seat);
    this.roomInfo();
  }

  private drop(seat: number, announce = true): void {
    const c = this.conns.get(seat);
    if (c) this.cid2seat.delete(c.cid);
    this.conns.delete(seat); this.seen.delete(seat); this.away.delete(seat); this.stillAsked.delete(seat);
    if (announce) this.roomInfo();
  }

  private roomInfo(): void {
    if (this._role !== 'host') return;
    const info: RoomInfo = { open: 1, players: this.count, max: this.max, running: this.game.isRunning() ? 1 : 0, world: this.world ? 1 : 0, ts: Date.now() };
    if (this.myAway) info.away = 1;
    this.pub(topics(this._code).room, info, true);
  }

  /** Clear a room's retained info (its host is gone), so quick match and joiners stop finding it. */
  private clearRoom(code: string): void {
    this.transport?.publish(topics(code).room, '', true);
  }

  private lost(): void {
    if (this._role !== 'client') return;
    const wasPlaying = this.game.isRunning();
    this._role = ''; this._err = 'hostleft';
    this.events.onHostLost?.(wasPlaying);
  }

  // ---- timers: state sync and heartbeats

  private startTimers(): void {
    if (!this.tickTimer) this.tickTimer = setInterval(() => { try { this.tick(); } catch { /* keep ticking */ } }, TICK_MS);
    if (!this.beatTimer) this.beatTimer = setInterval(() => { try { this.beat(); } catch { /* keep beating */ } }, BEAT_MS);
  }

  private stopTimers(): void {
    // NOTE: the PenguinMod version never stopped these (they idled with no role); stopping them is harmless.
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.tickTimer = this.beatTimer = null;
  }

  /** Whoever's turn it is sends the state when it changes (and once more when the turn passes on). */
  private tick(): void {
    if (!this._role || this.game.autoSync === false) return;
    if (!this.game.isRunning() && !this.was) return;
    const mine = this.game.turnOwner() === this._seat;
    if (mine || this.was) {
      const data = this.game.getState(), js = JSON.stringify(data);
      if (js !== this.last) { this.last = js; this.send({ t: 'state', data, from: this._seat }); }
    }
    this.was = mine;
  }

  private beat(): void {
    const t = topics(this._code);
    if (this._role === 'host') {
      this.pub(t.down, { t: 'hb' }); this.roomInfo();
      const now = Date.now();
      for (const [s, at] of [...this.seen]) {
        const asked = this.stillAsked.get(s);
        if (asked !== undefined) {
          // No "Still here" in time: they've left (and their device is told, if it can still hear us)
          if (now - asked > STILL_MS + STILL_GRACE_MS) { this.tellDropped(s); this.gone(s); }
          else this.askStill(s);                          // again, for a device that has just come back
        } else if (now - at > (this.away.has(s) ? AWAY_GONE_MS : GONE_MS)) {
          this.stillAsked.set(s, now);                    // gone quiet: ask before letting them go
          this.askStill(s);
        }
      }
    } else if (this._role === 'client') {
      this.pub(t.up, { t: 'hb', cid: this.cid });
      // While either page is in the background, silence is expected; back in front, setAway reconnects if needed
      // (Never while this page is in the background: it can't tell, and coming back checks the connection.)
      const limit = this.hostAway ? AWAY_GONE_MS : GONE_MS;
      if (!this.myAway && Date.now() - (this.lastSeen || Date.now()) > limit) this.lost();
    }
  }
}
