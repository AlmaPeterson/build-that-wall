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
    baseSettings: () => ({ ...DEFAULT_SETTINGS }),
    show: c => shown.push(c),
    wait: () => Promise.resolve(),
  });
}

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

  it("the player never receives the host's hand or the draw pile order", async () => {
    const { relay, hostC, clientC } = await twoPlayers();
    await hostC.act({ type: 'endTurn' });           // some play happens: the guest's turn starts
    await until(() => clientC.snapshot.get().view?.turn === 1);
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
    await hostC.act({ type: 'endTurn' });
    await until(() => clientC.snapshot.get().view?.turn === 1);
    expect((await hostC.act({ type: 'endTurn' })).ok).toBe(false);     // the host can't end the guest's turn
    const r = await clientC.act({ type: 'endTurn' });
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

  it('a player who leaves mid-game gets no more turns', async () => {
    const { guest, hostC } = await twoPlayers();
    guest.leave();
    await until(() => !!hostC.state!.over || !!hostC.state!.seats[1]!.left, 3000);
    expect(hostC.state!.seats[1]!.left).toBe(true);
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
  });
});
