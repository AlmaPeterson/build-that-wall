// Online extras: Gold stars in the lobby and on the board, a Gold member's own room code, named bots and rematches.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../game';
import { FakeRelay } from '../../services/online/fake-relay';
import type { GameController } from '../controller';
import { OnlineSession } from './session';

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 10));
  }
};

const sessions: OnlineSession[] = [];
afterEach(() => { for (const s of sessions.splice(0)) s.leave(); });

function session(relay: FakeRelay, name: string, shown: GameController[], gold = false, botNames: string[] = []) {
  const s = new OnlineSession({
    connect: relay.connect, name: () => name, gold: () => gold, botNames: () => botNames,
    baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
    show: c => shown.push(c),
    wait: () => Promise.resolve(),
  });
  sessions.push(s);
  return s;
}

describe('online Gold extras', () => {
  it('Gold members get a star in the lobby and on the board; named bots keep their names', async () => {
    const relay = new FakeRelay();
    const hostShown: GameController[] = [], guestShown: GameController[] = [];
    const host = session(relay, 'Hana', hostShown, true, ['Bot Rex']), guest = session(relay, 'Gus', guestShown, false);
    await host.hostRoom();
    await guest.join(host.state.get().code);
    await until(() => host.state.get().players.length === 2 && host.state.get().players[1]!.name === 'Gus');
    expect(host.state.get().players.map(p => !!p.gold)).toEqual([true, false]);
    await until(() => guest.state.get().players.length === 2);
    expect(guest.state.get().players[0]!.gold).toBe(true);
    host.setBots(1);
    void host.start(3);
    await until(() => !!hostShown[0]?.state);
    const seats = hostShown[0]!.state!.seats;
    expect(seats.map(s => !!s.gold)).toEqual([true, false, false]);
    expect(seats[2]!.name).toBe('Bot Rex');
    expect(host.canRematch()).toBe(false);                  // not while the game is on
  });

  it('a Gold room opens with the same code every time, unless it is open on another device', async () => {
    const relay = new FakeRelay();
    const a = session(relay, 'Ann', [], true), b = session(relay, 'Bea', [], true);
    expect(await a.hostRoom(6, 'GABCDE')).toBe(true);
    expect(a.state.get().code).toBe('GABCDE');
    expect(await b.hostRoom(6, 'GABCDE')).toBe(false);
    expect(b.state.get().error).toMatch(/already open/);
    a.leave();
    expect(await b.hostRoom(6, 'GABCDE')).toBe(true);
  }, 20_000);   // checking for a room nobody has open waits a few seconds

  it('Insane bots need a Gold host', async () => {
    const relay = new FakeRelay();
    const shown: GameController[] = [];
    const host = session(relay, 'Hana', shown, false);
    await host.hostRoom();
    host.setBots(1);
    host.setBotDifficulty(0, 'insane');
    void host.start(5);
    await until(() => !!shown[0]?.state);
    expect(shown[0]!.state!.seats[1]!.bot).toBe('hard');
  });
});
