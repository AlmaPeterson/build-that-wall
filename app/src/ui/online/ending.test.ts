// The host picks how an online game ends in the lobby; everyone in the room sees it, and the game uses it.
import { afterEach, expect, it } from 'vitest';
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

it('the host changes the ending in the lobby, players see it, and the game is played with it', async () => {
  const relay = new FakeRelay();
  const shown: GameController[] = [];
  const make = (name: string) => new OnlineSession({
    connect: relay.connect, name: () => name, show: c => shown.push(c), wait: () => Promise.resolve(),
    baseSettings: () => ({ ...DEFAULT_SETTINGS, ending: 2, endingTimes: 1 }),
  });
  const host = make('Hana'), other = make('Gus');
  sessions.push(host, other);
  await host.hostRoom();
  expect(host.state.get()).toMatchObject({ ending: 2, endingTimes: 1 });     // starts from Settings
  await other.join(host.state.get().code);
  await until(() => other.state.get().players.length === 2);

  host.setEnding(4, 2);
  await until(() => other.state.get().ending === 4);
  expect(other.state.get().endingTimes).toBe(2);
  other.setEnding(1);                                                     // only the host can change it
  expect(other.state.get().ending).toBe(4);

  void host.start(3);
  await until(() => shown.length >= 1 && !!shown[0]!.state);
  expect(shown[0]!.state!.settings).toMatchObject({ ending: 4, endingTimes: 2 });
  host.setEnding(1);                                                      // not once the game has started
  expect(host.state.get().ending).toBe(4);
});
