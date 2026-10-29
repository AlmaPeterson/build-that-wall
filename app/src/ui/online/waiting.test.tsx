// @vitest-environment happy-dom
// Online: everyone else sees who the game is waiting for, and "Still here?" keeps or ends a player's game.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Decision } from '../../game';
import { FakeRelay } from '../../services/online/fake-relay';
import type { GameController } from '../controller';
import { Overlays } from '../overlays/Overlays';
import { AWAY_NOTICE, OnlineSession } from './session';
import { StillHere } from './StillHere';

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 10));
  }
};

let root: HTMLDivElement;
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
afterEach(() => { render(null, root); root.remove(); for (const s of sessions.splice(0)) s.leave(); });

const sessions: OnlineSession[] = [];
function session(relay: FakeRelay, name: string, shown: GameController[], home?: () => void) {
  const s = new OnlineSession({
    connect: relay.connect, name: () => name,
    baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
    show: c => shown.push(c), wait: () => Promise.resolve(), home,
  });
  sessions.push(s);
  return s;
}

async function twoPlayers() {
  const relay = new FakeRelay();
  const hostShown: GameController[] = [], clientShown: GameController[] = [];
  const host = session(relay, 'Hana', hostShown), guest = session(relay, 'Gus', clientShown);
  expect(await host.hostRoom()).toBe(true);
  expect(await guest.join(host.state.get().code)).toBe(true);
  await until(() => host.state.get().players.length === 2);
  void host.start(7);
  await until(() => clientShown.length === 1 && !!clientShown[0]!.snapshot.get().view);
  return { host, guest, hostC: hostShown[0]!, clientC: clientShown[0]! };
}

describe('waiting for another player', () => {
  it("the host's screen shows who it's waiting for; the asked player gets the question, not the banner", async () => {
    const { hostC, clientC } = await twoPlayers();
    const block: Decision = { kind: 'block', seat: 1, attacker: 0, card: 7 };
    const answered = (hostC as unknown as { remote(s: number): { decide(d: Decision): Promise<unknown> } }).remote(1).decide(block);
    await until(() => !!hostC.snapshot.get().waitingFor && !!clientC.snapshot.get().prompt);
    expect(hostC.snapshot.get().waitingFor).toEqual({ seat: 1, kind: 'block', card: 7 });

    act(() => render(<Overlays controller={hostC} />, root));
    await until(() => !!root.querySelector('.btw-waiting'));
    expect(root.querySelector('.btw-waiting')!.textContent).toBe('Waiting for Gus to decide whether to block it with Self-Defense…');
    act(() => render(<Overlays controller={clientC} />, root));
    expect(root.querySelector('.btw-waiting')).toBeNull();      // Gus is the one answering

    clientC.snapshot.get().prompt!.answer(true as never);
    expect(await answered).toBe(true);
    await until(() => hostC.snapshot.get().waitingFor == null);
  });

  it("players see when the host is answering a question on the host's device", async () => {
    const { hostC, clientC } = await twoPlayers();
    void (hostC as unknown as { ask(d: Decision): Promise<unknown> }).ask({ kind: 'paySavings', seat: 0, attacker: 1, card: 7 } as Decision);
    await until(() => clientC.snapshot.get().waitingFor?.seat === 0);
    expect(clientC.snapshot.get().waitingFor).toEqual({ seat: 0, kind: 'paySavings', card: 7 });
    act(() => render(<Overlays controller={clientC} />, root));
    await until(() => !!root.querySelector('.btw-waiting'));
    expect(root.querySelector('.btw-waiting')!.textContent).toContain('Waiting for Hana to decide whether to pay the Debt with Savings');
  });

  it('only the kind of question and its card are shared, never the options (they can show a hidden hand)', async () => {
    const { hostC, clientC } = await twoPlayers();
    const give: Decision = { kind: 'chooseHandCard', seat: 1, card: 10, purpose: 'give', options: [0, 2], optional: false, to: 0 };
    void (hostC as unknown as { remote(s: number): { decide(d: Decision): Promise<unknown> } }).remote(1).decide(give);
    await until(() => !!hostC.snapshot.get().waitingFor);
    expect(hostC.snapshot.get().waitingFor).toEqual({ seat: 1, kind: 'chooseHandCard', card: 10, purpose: 'give' });
    await until(() => !!clientC.snapshot.get().prompt);
  });
});

describe('"Still here?"', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows a countdown; "Still here" closes it and keeps the game', async () => {
    const { guest } = await twoPlayers();
    vi.useFakeTimers();
    (guest as unknown as { askedStill(ms: number): void }).askedStill(60000);
    act(() => render(<StillHere session={guest} />, root));
    expect(root.textContent).toContain('STILL HERE?');
    expect(root.textContent).toContain('60');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(root.textContent).toContain('45');
    const button = [...root.querySelectorAll('button')].find(b => b.textContent === 'Still here')!;
    act(() => button.click());
    expect(guest.state.get().still).toBe(0);
    expect(guest.state.get().phase).toBe('playing');
    expect(root.textContent).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(guest.state.get().phase).toBe('playing');          // the countdown was stopped
  });

  it('time runs out: they leave the game and go back to the menu with a message', async () => {
    const { guest } = await twoPlayers();
    const home = vi.fn();
    (guest as unknown as { deps: { home?: () => void } }).deps.home = home;
    vi.useFakeTimers();
    (guest as unknown as { askedStill(ms: number): void }).askedStill(60000);
    act(() => render(<StillHere session={guest} />, root));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(home).toHaveBeenCalledOnce();
    expect(guest.state.get()).toMatchObject({ phase: 'idle', still: 0, notice: AWAY_NOTICE });
    expect(root.textContent).toContain(AWAY_NOTICE);
    act(() => [...root.querySelectorAll('button')].find(b => b.textContent === 'OK')!.click());
    expect(guest.state.get().notice).toBe('');
    expect(root.textContent).toBe('');
  });
});
