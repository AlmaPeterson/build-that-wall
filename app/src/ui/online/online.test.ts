// A two-player online game over the in-memory relay: the host runs the game, the other player only
// ever receives their own view, decisions round-trip, and the player's actions apply on the host.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Decider } from '../../game';
import { FakeRelay } from '../../services/online/fake-relay';
import type { GameController } from '../controller';
import { fallbackAnswer, parseAnswer, type ToPlayer } from './messages';
import { OnlineSession } from './session';

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 10));
  }
};

function session(relay: FakeRelay, name: string, shown: GameController[]) {
  return new OnlineSession({
    connect: relay.connect, name: () => name,
    baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
    show: c => shown.push(c),
    wait: () => Promise.resolve(),
  });
}

/** A person taps OK on their turn banner. */
const okTurn = async (c: GameController) => {
  await until(() => c.snapshot.get().turnBanner != null);
  c.turnOk();
};
/** The current player ends their turn and the next person (on `next`) taps OK. */
const passTurn = async (from: GameController, next: GameController) => {
  const ended = from.act({ type: 'endTurn' });
  await okTurn(next);
  return ended;
};

const sessions: OnlineSession[] = [];
afterEach(() => { for (const s of sessions.splice(0)) s.leave(); });

async function twoPlayers() {
  const relay = new FakeRelay();
  const hostShown: GameController[] = [], clientShown: GameController[] = [];
  const host = session(relay, 'Hana', hostShown), guest = session(relay, 'Gus', clientShown);
  sessions.push(host, guest);
  expect(await host.hostRoom()).toBe(true);
  const code = host.state.get().code;
  expect(await guest.join(code)).toBe(true);
  await until(() => host.state.get().players.length === 2 && host.state.get().players[1]!.name === 'Gus');
  await until(() => guest.state.get().players.length === 2);
  void host.start(7);
  await until(() => clientShown.length === 1 && !!clientShown[0]!.snapshot.get().view);
  await okTurn(hostShown[0]!);
  await until(() => hostShown[0]!.api!.resting);
  return { relay, host, guest, hostC: hostShown[0]!, clientC: clientShown[0]! };
}

describe('online game', () => {
  it('lobby names reach everyone, and the game starts on both devices', async () => {
    const { host, guest, hostC, clientC } = await twoPlayers();
    expect(guest.state.get().players.map(p => p.name)).toEqual(['Hana', 'Gus']);
    expect(host.state.get().phase).toBe('playing');
    expect(guest.state.get().phase).toBe('playing');
    expect(hostC.state!.seats.map(s => s.name)).toEqual(['Hana', 'Gus']);
    expect(clientC.snapshot.get().viewer).toBe(1);
  });

  it("a player's dropped connection comes back and the game reaches them again", async () => {
    const { relay, guest, hostC, clientC } = await twoPlayers();
    relay.open[1]!.drop();                                  // the guest's connection (the host connected first)
    await new Promise(r => setTimeout(r, 50));
    expect(guest.state.get().phase).toBe('playing');
    await passTurn(hostC, clientC);
    await until(() => clientC.snapshot.get().view!.seats[1]!.hand.length === hostC.state!.seats[1]!.hand.length);
    expect(clientC.snapshot.get().view!.seats[1]!.hand).toEqual(hostC.state!.seats[1]!.hand);
  });

  it("the host picks each bot's difficulty in the lobby", async () => {
    const relay = new FakeRelay();
    const shown: GameController[] = [];
    const host = session(relay, 'Hana', shown);
    sessions.push(host);
    expect(await host.hostRoom()).toBe(true);
    host.setBots(3);
    host.setBotDifficulty(0, 'hard');
    host.setBotDifficulty(1, 'easy');
    host.setBotDifficulty(2, 'random');
    expect(host.state.get().difficulties.slice(0, 3)).toEqual(['hard', 'easy', 'random']);
    void host.start(7);
    await until(() => shown.length === 1 && !!shown[0]!.state);
    const bots = shown[0]!.state!.seats.slice(1).map(s => s.bot);
    expect(bots.slice(0, 2)).toEqual(['hard', 'easy']);
    expect(['easy', 'medium', 'hard']).toContain(bots[2]);           // random picks one
  });

  it("the player never receives the host's hand or the draw pile order", async () => {
    const { relay, hostC, clientC } = await twoPlayers();
    await passTurn(hostC, clientC);                 // some play happens: the guest's turn starts
    await until(() => clientC.snapshot.get().view!.seats[1]!.hand.length === hostC.state!.seats[1]!.hand.length);
    const snaps = relay.log.map(l => { try { return JSON.parse(l.payload); } catch { return null; } })
      .filter(m => m && m.t === 'x' && m.data?.k === 'snap').map(m => m.data as Extract<ToPlayer, { k: 'snap' }>);
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      expect(s.view.seats[0]!.hand.every(id => id === 4)).toBe(true);
      expect(s.view.draw.every(id => id === 4)).toBe(true);
      for (const e of s.events) if ((e.type === 'draw' || e.type === 'deal') && e.seat === 0) expect(e.cards?.every(id => id === 4) ?? true).toBe(true);
    }
    // The guest's own hand is real
    expect(clientC.snapshot.get().view!.seats[1]!.hand).toEqual(hostC.state!.seats[1]!.hand);
  });

  it("the player's actions apply on the host", async () => {
    const { hostC, clientC } = await twoPlayers();
    expect((await clientC.act({ type: 'endTurn' })).ok).toBe(false);   // not their turn yet
    await passTurn(hostC, clientC);
    await until(() => clientC.snapshot.get().view?.turn === 1);
    expect((await hostC.act({ type: 'endTurn' })).ok).toBe(false);     // the host can't end the guest's turn
    const r = await passTurn(clientC, hostC);
    expect(r.ok).toBe(true);
    expect(hostC.state!.turn).toBe(0);
  });

  it("the host's questions are answered on the player's device", async () => {
    const { hostC, clientC } = await twoPlayers();
    const remote = (hostC as unknown as { remote(seat: number): Decider }).remote(1);
    const asked = remote.decide({ kind: 'block', seat: 1, attacker: 0, card: 9 }, hostC.state!);
    await until(() => clientC.snapshot.get().prompt?.decision.kind === 'block');
    clientC.snapshot.get().prompt!.answer(true as never);
    expect(await asked).toBe(true);
  });

  it("the player's cards wait for their OK on their own device, and everyone else sees why", async () => {
    const { hostC, clientC } = await twoPlayers();
    const ended = hostC.act({ type: 'endTurn' });
    await until(() => clientC.snapshot.get().turnBanner === 1);
    expect(hostC.snapshot.get().waitingFor).toMatchObject({ seat: 1, kind: 'turnOk' });
    expect(hostC.allEvents.filter(e => e.type === 'draw' && e.seat === 1)).toHaveLength(0);
    clientC.turnOk();
    expect((await ended).ok).toBe(true);
    expect(hostC.allEvents.filter(e => e.type === 'draw' && e.seat === 1)).toHaveLength(1);
    expect(hostC.snapshot.get().waitingFor).toBeNull();
  });

  it('a player who leaves while the game waits for their OK does not hold everyone up: a bot plays for them', async () => {
    const { hostC, clientC, guest } = await twoPlayers();
    const ended = hostC.act({ type: 'endTurn' });
    await until(() => clientC.snapshot.get().turnBanner === 1);
    guest.leave();
    await okTurn(hostC);                                     // the bot played their turn: the host's turn again
    expect((await ended).ok).toBe(true);
    const seat = hostC.state!.seats[1]!;
    expect(seat).toMatchObject({ bot: 'medium', standIn: true, left: false, name: 'Gus' });
    expect(hostC.state!.turn).toBe(0);
    expect(hostC.allEvents.filter(e => e.type === 'draw' && e.seat === 1)).toHaveLength(1);
    expect(hostC.allEvents.some(e => e.text === 'Gus left the game, so a bot is playing for them.')).toBe(true);
    expect(hostC.state!.over).toBeNull();                    // the game goes on
  });

  it('a player who leaves mid-game keeps their cards in the game, played by a bot', async () => {
    const { guest, hostC } = await twoPlayers();
    const hand = hostC.state!.seats[1]!.hand.length;
    guest.leave();
    await until(() => !!hostC.state!.seats[1]!.standIn);
    expect(hostC.state!.seats[1]!.hand.length).toBe(hand);
    await passTurn(hostC, hostC);                            // the bot's turn, then the host's banner
    expect(hostC.state!.turn).toBe(0);
  });

  it("the host can let a bot play for someone who isn't moving, and they can take their seat back", async () => {
    const { hostC, clientC } = await twoPlayers();
    await passTurn(hostC, clientC);
    await until(() => hostC.api!.resting && hostC.state!.turn === 1);
    expect(hostC.canHandToBot(0)).toBe(false);               // never the host's own seat
    expect(hostC.canHandToBot(1)).toBe(true);
    hostC.handToBot(1);
    await okTurn(hostC);                                     // the bot finished the guest's turn
    expect(hostC.state!.seats[1]).toMatchObject({ bot: 'medium', standIn: true });
    expect(hostC.canHandToBot(1)).toBe(false);
    // The guest still sees their own hand, and can take the seat back
    await until(() => !!clientC.snapshot.get().view?.seats[1]?.standIn);
    expect(clientC.snapshot.get().view!.seats[1]!.hand).toEqual(hostC.state!.seats[1]!.hand);
    expect(clientC.canPlayAgain()).toBe(true);
    clientC.playAgain();
    await until(() => hostC.state!.seats[1]!.bot === null);
    expect(hostC.state!.seats[1]!.standIn).toBe(false);
    await until(() => !clientC.canPlayAgain());
    // Their turn again: it waits for them (they may get a turn banner or a Play Immediately card first, by the deal)
    void hostC.act({ type: 'endTurn' });
    await until(() => hostC.state!.turn === 1 && !!clientC.snapshot.get().view);
    await new Promise(r => setTimeout(r, 300));
    expect(hostC.state!.turn).toBe(1);
    expect(hostC.state!.seats[1]).toMatchObject({ bot: null, standIn: false });
    expect(hostC.allEvents.filter(e => e.type === 'turnEnd').at(-1)?.text).toBe('Hana ended their turn.');
  });

  it('leaving from End Game (or Back) tells the host straight away, and "Back to the game" shows the board again', async () => {
    const relay = new FakeRelay();
    const hostShown: GameController[] = [], clientShown: GameController[] = [];
    let home = 0;
    const host = session(relay, 'Hana', hostShown);
    const guest = new OnlineSession({
      connect: relay.connect, name: () => 'Gus', baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
      show: c => clientShown.push(c), wait: () => Promise.resolve(), home: () => { home++; },
    });
    sessions.push(host, guest);
    await host.hostRoom();
    await guest.join(host.state.get().code);
    await until(() => host.state.get().players.length === 2);
    void host.start(7);
    await until(() => clientShown.length === 1);
    guest.backToGame();
    expect(clientShown).toHaveLength(2);
    expect(clientShown[1]).toBe(clientShown[0]);
    guest.askLeave();
    expect(guest.state.get().confirmLeave).toBe(true);
    guest.keepPlaying();
    expect(guest.state.get().confirmLeave).toBe(false);
    guest.askLeave();
    guest.confirmLeave();
    expect(home).toBe(1);
    expect(guest.state.get().phase).toBe('idle');
    await until(() => !!hostShown[0]!.state?.seats[1]?.standIn);
  });

  it('a question waiting on someone is answered for them when a bot takes over', async () => {
    const { hostC, clientC } = await twoPlayers();
    const remote = (hostC as unknown as { remote(seat: number): Decider }).remote(1);
    const asked = remote.decide({ kind: 'block', seat: 1, attacker: 0, card: 9 }, hostC.state!);
    await until(() => clientC.snapshot.get().prompt?.decision.kind === 'block');
    hostC.handToBot(1);
    expect(await asked).toBe(false);                         // the safe answer: don't block
  });
});

describe('rejoining', () => {
  /** A device's saved rejoin info, shared by the page before and after a reload. */
  const device = () => { let v = ''; return { load: () => v, save: (x: string | null) => { v = x ?? ''; } }; };
  const guestPage = (relay: FakeRelay, store: ReturnType<typeof device>, shown: GameController[], now = () => Date.now()) => {
    const g = new OnlineSession({
      connect: relay.connect, name: () => 'Gus', baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
      show: c => shown.push(c), wait: () => Promise.resolve(), rejoinStore: store, now,
    });
    sessions.push(g);
    return g;
  };
  async function game(store: ReturnType<typeof device>) {
    const relay = new FakeRelay();
    const hostShown: GameController[] = [], clientShown: GameController[] = [];
    const host = session(relay, 'Hana', hostShown);
    sessions.push(host);
    const guest = guestPage(relay, store, clientShown);
    await host.hostRoom();
    await guest.join(host.state.get().code);
    await until(() => host.state.get().players.length === 2);
    void host.start(7);
    await until(() => clientShown.length === 1 && !!clientShown[0]!.snapshot.get().view);
    await okTurn(hostShown[0]!);
    await until(() => hostShown[0]!.api!.resting);
    return { relay, host, guest, hostC: hostShown[0]!, clientC: clientShown[0]! };
  }

  it('after a reload the page goes straight back into the game, to the same seat, and the bot stops', async () => {
    const store = device();
    const { relay, guest, hostC } = await game(store);
    const hand = [...hostC.state!.seats[1]!.hand];
    guest.pageClosing();                                         // the page reloads
    await until(() => !!hostC.state!.seats[1]!.standIn);
    const shown: GameController[] = [];
    const again = guestPage(relay, store, shown);                // the reloaded page
    expect(again.autoRejoinable()).toBe(true);
    expect(await again.rejoin()).toBe(true);
    await until(() => hostC.state!.seats[1]!.bot === null);
    expect(hostC.state!.seats[1]!.standIn).toBe(false);
    await until(() => shown.length === 1 && !!shown[0]!.snapshot.get().view);
    expect(again.state.get().phase).toBe('playing');
    expect(shown[0]!.snapshot.get().viewer).toBe(1);
    expect(shown[0]!.snapshot.get().view!.seats[1]!.hand).toEqual(hand);    // nothing was played meanwhile
    expect(shown[0]!.snapshot.get().events.length).toBe(hostC.allEvents.length);
    expect(hostC.allEvents.some(e => e.text === 'Gus is back and playing again.')).toBe(true);
    // Their turn waits for them again
    await passTurn(hostC, shown[0]!);
    await until(() => hostC.api!.resting && hostC.state!.turn === 1);
  });

  it('after choosing Leave, the game is offered (not joined) from the Online screen', async () => {
    const store = device();
    const { relay, guest, hostC } = await game(store);
    guest.askLeave(); guest.confirmLeave();
    await until(() => !!hostC.state!.seats[1]!.standIn);
    const again = guestPage(relay, store, []);
    expect(again.autoRejoinable()).toBe(false);
    expect(again.rejoinable()).not.toBeNull();
    expect(await again.rejoin()).toBe(true);
    await until(() => hostC.state!.seats[1]!.bot === null);
  });

  it('a game that has gone (or an hour later) is not offered, and a failed rejoin says why', async () => {
    const store = device();
    const { relay, guest, host } = await game(store);
    guest.pageClosing();
    let t = Date.now();
    const later = guestPage(relay, store, [], () => t);
    t += 61 * 60000;
    expect(later.rejoinable()).toBeNull();
    host.leave();                                                // the host closed the game
    const again = guestPage(relay, store, []);
    expect(await again.rejoin()).toBe(false);
    expect(again.state.get().error).toMatch(/Couldn't get back/);
    expect(again.rejoinable()).toBeNull();                       // forgotten
  });

  it("the host doesn't give a seat to someone who wasn't in the game", async () => {
    const store = device();
    const { relay } = await game(store);
    store.save(JSON.stringify({ code: 'ZZZZZ', cid: 'cnobody', at: Date.now(), auto: true }));
    expect(await guestPage(relay, store, []).rejoin()).toBe(false);
  });
});

describe('remote answers', () => {
  it('bad or missing answers fall back safely', () => {
    const block = { kind: 'block', seat: 1, attacker: 0, card: 9 } as const;
    expect(parseAnswer(block, 'no')).toBe(false);
    expect(parseAnswer(block, 'true')).toBe(true);
    const seat = { kind: 'chooseSeat' as const, seat: 1, card: 6, options: [0, 2], cancellable: false };
    expect(parseAnswer(seat, '5')).toBe(0);
    expect(parseAnswer(seat, '2')).toBe(2);
    expect(fallbackAnswer({ ...seat, cancellable: true })).toBeNull();
    expect(parseAnswer({ kind: 'pickCards', seat: 1, card: 22, pool: [1, 2], max: 1 }, '[1,2]')).toEqual([]);
    const build = { kind: 'pickHandCards' as const, seat: 1, card: 13, purpose: 'build' as const, options: [2, 4, 5], cards: [29, 30, 31], min: 1, max: 2 };
    expect(parseAnswer(build, '[5,2]')).toEqual([5, 2]);
    expect(parseAnswer(build, '[2,4,5]')).toEqual([2]);          // too many
    expect(parseAnswer(build, '[3]')).toEqual([2]);              // not an option
    expect(parseAnswer(build, '[2,2]')).toEqual([2]);            // repeated
    expect(parseAnswer(build, '[]')).toEqual([2]);               // too few
  });
});
