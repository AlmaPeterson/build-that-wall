import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRelay, FakeTransport } from './fake-relay';
import { topics, type AskMsg } from './protocol';
import { OnlineRoom, cleanName, seatOwner, type GameHooks, type RoomEvents } from './room';

/** A tiny stand-in for the game: whose turn it is, and some shared data. */
class FakeGame implements GameHooks {
  running = false;
  turnNo = 1;
  players = 2;
  ai = 0;
  left: number[] = [];
  data: Record<string, unknown> = {};
  applied = 0;
  getState() { return { running: this.running, turn: this.turnNo, players: this.players, ai: this.ai, data: this.data }; }
  applyState(s: unknown) {
    const o = s as ReturnType<FakeGame['getState']>;
    this.running = o.running; this.turnNo = o.turn; this.players = o.players; this.ai = o.ai; this.data = o.data;
    this.applied++;
  }
  isRunning() { return this.running; }
  turn() { return this.turnNo; }
  turnOwner() { return seatOwner(this.turnNo, this.players, this.ai, this.left); }
}

function device(relay: FakeRelay, seq: number[] = []) {
  const game = new FakeGame();
  const events = {
    seats: [] as number[], myTurns: 0, endTurns: 0, left: [] as number[], lost: [] as boolean[], status: [] as string[], reconnected: 0,
    ask: undefined as ((q: AskMsg) => Promise<string>) | undefined,
  };
  const hooks: RoomEvents = {
    onSeat: (s) => events.seats.push(s),
    onMyTurn: () => events.myTurns++,
    onEndTurn: () => events.endTurns++,
    onPlayerLeft: (s) => events.left.push(s),
    onHostLost: (w) => events.lost.push(w),
    onStatus: (t) => events.status.push(t),
    onReconnected: () => events.reconnected++,
    onAsk: (q) => (events.ask ? events.ask(q) : new Promise(() => {})),
  };
  let i = 0;
  const random = () => (seq.length ? seq[i++ % seq.length]! : Math.random());
  return { game, events, room: new OnlineRoom(relay.connect, game, hooks, random) };
}

/** Let fake timers and fake network deliveries run. */
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('pure helpers', () => {
  it('seatOwner: humans play their own turns, the host plays bots and empty seats', () => {
    expect(seatOwner(2, 4, 1, [])).toBe(2);
    expect(seatOwner(4, 4, 1, [])).toBe(1);      // seat 4 is a bot
    expect(seatOwner(3, 4, 0, [0, 0, 1])).toBe(1); // seat 3's player left
    expect(seatOwner(1, 2, 0, [])).toBe(1);
  });

  it('cleanName: control characters become spaces, max 20 characters', () => {
    expect(cleanName('  Bob\tSmith  ')).toBe('Bob Smith');
    expect(cleanName('A'.repeat(30))).toBe('A'.repeat(20));
    expect(cleanName('😀'.repeat(25))).toBe('😀'.repeat(20));
  });
});

describe('OnlineRoom', () => {
  let relay: FakeRelay;
  beforeEach(() => { vi.useFakeTimers(); relay = new FakeRelay(); });
  afterEach(() => { vi.useRealTimers(); });

  async function hostAndJoin() {
    const host = device(relay, [0]);          // code AAAAA
    const p = host.room.host({ max: 4 });
    await run(0);
    const code = await p;
    const guest = device(relay);
    const joining = guest.room.join(code);
    await run(100);
    const seat = await joining;
    return { host, guest, code, seat };
  }

  it('hosts with a 5-letter code and publishes retained room info', async () => {
    const host = device(relay, [0]);
    const code = await host.room.host({ max: 9, world: true });
    expect(code).toBe('AAAAA');
    expect(host.room.role).toBe('host');
    expect(host.room.seat).toBe(1);
    const info = relay.sent(topics(code).room).at(-1)!;
    expect(info).toMatchObject({ open: 1, players: 1, max: 6, running: 0, world: 1 });
  });

  it('reports a network error when no relay answers', async () => {
    relay.online = false;
    const host = device(relay);
    expect(await host.room.host()).toBe('');
    expect(host.room.error).toBe('network');
    expect(host.room.errorMessage).toBe('Could not reach the online service (check your internet).');
  });

  it('reports a load error when the library fails to load', async () => {
    const game = new FakeGame();
    const room = new OnlineRoom(() => Promise.reject(new Error('offline')), game);
    expect(await room.join('ABCDE')).toBe(0);
    expect(room.errorMessage).toBe('Could not load the online library (check internet).');
  });

  it('joins: the guest gets seat 2 and both count 2 players', async () => {
    const { host, guest, seat } = await hostAndJoin();
    expect(seat).toBe(2);
    expect(guest.room.role).toBe('client');
    expect(guest.room.seat).toBe(2);
    expect(guest.events.seats).toContain(2);
    expect(host.room.count).toBe(2);
    expect(guest.room.count).toBe(1);
  });

  it('joining an empty code or a closed room fails', async () => {
    const guest = device(relay);
    expect(await guest.room.join('  ')).toBe(0);
    const p = guest.room.join('nope1');
    await run(3000);
    expect(await p).toBe(0);
    expect(guest.room.error).toBe('peer-unavailable');
  });

  it('a full room says so, or lets spectators watch in Gold rooms', async () => {
    const host = device(relay, [0]);
    const code = await host.room.host({ max: 2 });
    const g1 = device(relay); const p1 = g1.room.join(code); await run(100); expect(await p1).toBe(2);
    const g2 = device(relay); const p2 = g2.room.join(code); await run(100); expect(await p2).toBe(0);

    const relay2 = new FakeRelay(); relay = relay2;
    const gold = device(relay2, [0.5]);
    gold.game.data = { hello: 'watchers' };
    const code2 = await gold.room.host({ max: 2, spectators: true });
    const a = device(relay2); const pa = a.room.join(code2); await run(100); expect(await pa).toBe(2);
    const watcher = device(relay2); const pw = watcher.room.join(code2); await run(100);
    expect(await pw).toBe(-1);
    expect(watcher.room.seat).toBe(0);
    expect(watcher.game.data).toEqual({ hello: 'watchers' });
  });

  it('the player whose turn it is sends the state; others apply it', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true; host.game.data = { walls: [1] };
    await run(150);
    expect(guest.game.running).toBe(true);
    expect(guest.game.data).toEqual({ walls: [1] });

    // host passes the turn to seat 2: guest is told it's their turn
    host.game.turnNo = 2;
    await run(150);
    expect(guest.game.turnNo).toBe(2);
    expect(guest.events.myTurns).toBe(1);

    // now the guest's changes flow back to the host, and aren't echoed
    guest.game.data = { walls: [1, 2] };
    await run(150);
    expect(host.game.data).toEqual({ walls: [1, 2] });
    const states = relay.sent(topics(host.room.code).down).filter((m) => m.t === 'state');
    const relayed = states.at(-1)!;
    expect(relayed._except).toBe(2);          // the host relays it to everyone but the sender
  });

  it('does not send state when nothing changed', async () => {
    const { host } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    const n = relay.sent(topics(host.room.code).down).filter((m) => m.t === 'state').length;
    await run(1000);
    expect(relay.sent(topics(host.room.code).down).filter((m) => m.t === 'state').length).toBe(n);
  });

  it('endTurn asks the device that plays the current turn', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    host.game.turnNo = 2;
    await run(150);
    host.room.endTurn();
    await run(10);
    expect(guest.events.endTurns).toBe(1);
    guest.room.endTurn();                     // guest's own turn: handled right here
    expect(guest.events.endTurns).toBe(2);
    guest.game.turnNo = 1; host.game.turnNo = 1;
    guest.room.endTurn();
    await run(10);
    expect(host.events.endTurns).toBe(1);
  });

  it('ask: questions go to the other seat and answers come back', async () => {
    const { host, guest } = await hostAndJoin();
    guest.events.ask = async (q) => (q.card === 7 ? 'yes' : 'no');
    const answer = host.room.ask(2, { l1: 'Block?', l2: '', l3: '', card: 7, mode: 'block' });
    await run(10);
    expect(await answer).toBe('yes');

    host.events.ask = async () => 'maybe';
    const back = guest.room.ask(1, { l1: 'x', l2: '', l3: '', card: 0, mode: '' });
    await run(10);
    expect(await back).toBe('maybe');
  });

  it('ask: an unknown seat or no answer gives "no"', async () => {
    const { host } = await hostAndJoin();
    expect(await host.room.ask(5, { l1: '', l2: '', l3: '', card: 0, mode: '' })).toBe('no');
    const slow = host.room.ask(2, { l1: '', l2: '', l3: '', card: 0, mode: '' });   // guest never answers
    await run(45001);
    expect(await slow).toBe('no');
    const offline = device(relay);
    expect(await offline.room.ask(2, { l1: '', l2: '', l3: '', card: 0, mode: '' })).toBe('no');
  });

  it('a player who says goodbye in the lobby frees the seat', async () => {
    const { host, guest } = await hostAndJoin();
    guest.room.leave();
    await run(10);
    expect(host.room.count).toBe(1);
    expect(host.events.left).toEqual([]);
  });

  it('a player who leaves mid-game is announced to everyone', async () => {
    const { host, guest, code } = await hostAndJoin();
    const g3 = device(relay); const p3 = g3.room.join(code); await run(100); expect(await p3).toBe(3);
    host.game.running = true;
    await run(150);
    guest.room.leave();
    await run(10);
    expect(host.events.left).toEqual([2]);
    expect(g3.events.left).toEqual([2]);
    expect(host.room.count).toBe(2);
  });

  it('heartbeat: a silent player is dropped after 30 seconds', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    (guest.room['transport'] as unknown as FakeTransport).silence();  // no goodbye, just gone
    await run(20000);
    expect(host.events.left).toEqual([]);
    await run(15000);
    expect(host.events.left).toEqual([2]);
    expect(host.room.count).toBe(1);
  });

  it('heartbeat: a silent host is noticed by players', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    (host.room['transport'] as unknown as FakeTransport).silence();
    await run(35000);
    expect(guest.events.lost).toEqual([true]);
    expect(guest.room.role).toBe('');
    expect(guest.room.errorMessage).toBe('The host left the game.');
  });

  it('the host leaving ends the game for players and closes the room', async () => {
    const { host, guest, code } = await hostAndJoin();
    host.room.leave();
    await run(10);
    expect(guest.events.lost).toEqual([false]);
    expect(relay.log.filter((l) => l.topic === topics(code).room).at(-1)).toMatchObject({ payload: '', retain: true });
    expect(host.room.role).toBe('');
    expect(host.room.seat).toBe(1);
  });

  it('a dropped connection that never comes back counts as the host leaving', async () => {
    const { guest } = await hostAndJoin();
    relay.online = false;
    relay.dropAll();
    await run(30000);
    expect(guest.events.lost).toEqual([]);                    // still trying
    await run(60000);
    expect(guest.events.lost).toEqual([false]);
  });

  it('a dropped connection reconnects: same room, same seat, and the game carries on', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    (guest.room['transport'] as unknown as FakeTransport).drop();
    await run(200);
    expect(guest.events.reconnected).toBe(1);
    expect(guest.room.role).toBe('client');
    expect(guest.room.seat).toBe(2);
    expect(host.room.count).toBe(2);
    await run(60000);                                         // heartbeats flow again: nobody is dropped
    expect(host.events.left).toEqual([]);
    expect(guest.events.lost).toEqual([]);
  });

  it('a player in the background (another window or app) is not dropped for minutes', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    guest.room.setAway(true);
    await run(10);
    (guest.room['transport'] as unknown as FakeTransport).silence();   // a frozen page: no heartbeats at all
    await run(5 * 60000);
    expect(host.events.left).toEqual([]);
    expect(host.room.count).toBe(2);
    await run(6 * 60000);                                     // gone for good after 10 minutes
    expect(host.events.left).toEqual([2]);
  });

  it('coming back to the page reconnects if the connection died meanwhile', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    guest.room.setAway(true);
    await run(10);
    (guest.room['transport'] as unknown as FakeTransport).silence();   // died without a close event
    await run(3 * 60000);
    expect(guest.events.lost).toEqual([]);                    // the player doesn't give up while in the background
    guest.room.setAway(false);
    await run(200);
    expect(guest.events.reconnected).toBe(1);
    expect(guest.room.seat).toBe(2);
    await run(60000);
    expect(host.events.left).toEqual([]);
    expect(guest.events.lost).toEqual([]);
  });

  it('a host in the background is not taken for gone', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    host.room.setAway(true);
    await run(10);
    (host.room['transport'] as unknown as FakeTransport).silence();
    await run(5 * 60000);
    expect(guest.events.lost).toEqual([]);
    expect(guest.room.role).toBe('client');
  });

  it('closing the page (leave) still says goodbye straight away', async () => {
    const { host, guest } = await hostAndJoin();
    host.game.running = true;
    await run(150);
    guest.room.leave();
    await run(10);
    expect(host.events.left).toEqual([2]);
  });

  it('quick match joins the fullest open world room', async () => {
    const small = device(relay, [0.1]); await small.room.host({ world: true });
    const big = device(relay, [0.2]); const bigCode = await big.room.host({ world: true });
    const g = device(relay); const pg = g.room.join(bigCode); await run(100); await pg;
    const priv = device(relay, [0.3]); await priv.room.host({ world: false });

    const me = device(relay);
    const p = me.room.quick(6);
    await run(2200);
    expect(await p).toBe(3);
    expect(me.room.code).toBe(bigCode);
    expect(me.events.status).toEqual(['Connecting to the online service...', 'Looking for an online game...', 'Joining an online game...']);
  });

  it('quick match opens a world room when nobody is waiting', async () => {
    const me = device(relay, [0]);
    const p = me.room.quick(4);
    await run(2100);
    expect(await p).toBe(1);
    expect(me.room.role).toBe('host');
    expect(me.room.code).toBe('WAAAAA');
    expect(relay.sent(topics('WAAAAA').room).at(-1)).toMatchObject({ world: 1, max: 4 });
  });
});
