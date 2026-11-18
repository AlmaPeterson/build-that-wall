// Pass'n'Play inside an online game: two people on one device and one on another. The device with two
// people is passed between them on their turns; each only ever sees their own hand.
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_BACK, DEFAULT_SETTINGS } from '../../game';
import { FakeRelay } from '../../services/online/fake-relay';
import type { GameController } from '../controller';
import { fallbackAnswer } from './messages';
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

const sessions: OnlineSession[] = [];
afterEach(() => { for (const s of sessions.splice(0)) s.leave(); });

/** The person on the turn banner (or, on a shared device, the pass screen) is ready, and their cards are drawn. */
async function takeTurn(c: GameController, seat: number) {
  await until(() => c.snapshot.get().passTo === seat || c.snapshot.get().turnBanner === seat);
  if (c.snapshot.get().passTo === seat) c.ready();
  await until(() => c.snapshot.get().turnBanner === seat);
  c.turnOk();
  // Answer anything a Play Immediately card asks, until it's their move
  await until(() => {
    const sn = c.snapshot.get();
    if (sn.passTo !== null) c.ready();
    else if (sn.prompt) sn.prompt.answer(fallbackAnswer(sn.prompt.decision));
    return c.state?.turn === seat && sn.turnBanner == null && !sn.prompt && !!c.api?.resting;
  });
}

async function room(hostGuests: string[], clientGuests: string[]) {
  const relay = new FakeRelay();
  const hostShown: GameController[] = [], clientShown: GameController[] = [];
  const host = session(relay, 'Hana', hostShown), other = session(relay, 'Gus', clientShown);
  sessions.push(host, other);
  expect(await host.hostRoom()).toBe(true);
  for (const g of hostGuests) host.addGuest(g);
  expect(await other.join(host.state.get().code)).toBe(true);
  for (const g of clientGuests) other.addGuest(g);
  const people = 2 + hostGuests.length + clientGuests.length;
  await until(() => host.state.get().players.length === people && other.state.get().players.length === people);
  return { host, other, hostShown, clientShown };
}

describe('more people on one device', () => {
  it('shows guests in the lobby next to the device they play on', async () => {
    const { host, other } = await room([], ['Gail']);
    expect(other.state.get().players).toEqual([
      { seat: 1, name: 'Hana' }, { seat: 2, name: 'Gus' }, { seat: 2, name: 'Gail', guest: true },
    ]);
    other.removeGuest(0);
    await until(() => host.state.get().players.length === 2);
  });

  it('never lets the game go over 6 players, with bots counted', async () => {
    const { host } = await room(['A', 'B'], ['C', 'D']);
    host.setBots(5);
    expect(host.state.get().bots).toBe(0);
    expect(host.addGuest('E')).toBe(false);                 // a 7th person doesn't fit
    expect(host.state.get().players.map(p => p.name)).toEqual(['Hana', 'A', 'B', 'Gus', 'C', 'D']);
  });

  it('passes the other device between its two people, each seeing only their own hand', async () => {
    const { host, hostShown, clientShown } = await room([], ['Gail']);
    void host.start(11);
    await until(() => hostShown.length === 1 && clientShown.length === 1);
    const hostC = hostShown[0]!, clientC = clientShown[0]!;
    expect(hostC.state!.seats.map(s => s.name)).toEqual(['Hana', 'Gus', 'Gail']);

    await takeTurn(hostC, 0);
    void hostC.act({ type: 'endTurn' });
    await takeTurn(clientC, 1);                              // Gus's turn: the device is handed to him
    expect(clientC.snapshot.get().viewer).toBe(1);
    expect(clientC.state!.seats[2]!.hand.every(c => c === CARD_BACK)).toBe(true);    // Gail's cards stay hidden from Gus

    await until(() => !!hostC.api?.resting);                 // the host has finished Gus's draw
    void clientC.act({ type: 'endTurn' });
    // Gail's turn, on the same device: it must be passed to her first
    await until(() => clientC.snapshot.get().passTo === 2);
    expect(clientC.snapshot.get().prompt).toBeNull();
    await takeTurn(clientC, 2);
    expect(clientC.snapshot.get().viewer).toBe(2);
    expect(clientC.state!.seats[2]!.hand).toEqual(hostC.state!.seats[2]!.hand);
    expect(clientC.state!.seats[1]!.hand.every(c => c === CARD_BACK)).toBe(true);   // and Gus's are hidden from her
    await until(() => !!hostC.api?.resting);
    void clientC.act({ type: 'endTurn' });
    await until(() => hostC.state!.turn === 0);
  });

  it("lets the host's own guest play on the host's device", async () => {
    const { host, hostShown } = await room(['Hal'], []);
    void host.start(5);
    await until(() => hostShown.length === 1);
    const hostC = hostShown[0]!;
    expect(hostC.state!.seats.map(s => s.name)).toEqual(['Hana', 'Hal', 'Gus']);
    await takeTurn(hostC, 0);
    void hostC.act({ type: 'endTurn' });
    await takeTurn(hostC, 1);                                // passed to Hal on the host's device
    expect(hostC.snapshot.get().viewer).toBe(1);
    expect(hostC.snapshot.get().view!.seats[0]!.hand.every(c => c === CARD_BACK)).toBe(true);
    void hostC.act({ type: 'endTurn' });
    // Gus's turn is on the other device: nothing to pass here, and Gus's hand never shows
    await until(() => hostC.state!.turn === 2);
    expect(hostC.snapshot.get().passTo).toBeNull();
    expect(hostC.snapshot.get().view!.seats[2]!.hand.every(c => c === CARD_BACK)).toBe(true);
  });
});
