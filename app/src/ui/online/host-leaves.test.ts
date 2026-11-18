// The host leaving a running online game: another player's device takes over hosting, a bot plays the old
// host's cards, and when the old host comes back they get their seat back and host the game again.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../game';
import { FakeRelay } from '../../services/online/fake-relay';
import type { GameController } from '../controller';
import { fallbackAnswer } from './messages';
import { OnlineSession } from './session';

const until = async (ok: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 10));
  }
};

const sessions: OnlineSession[] = [];
afterEach(() => { for (const s of sessions.splice(0)) s.leave(); });

/** A device's saved rejoin info, shared by the page before and after a reload. */
const device = () => { let v = ''; return { load: () => v, save: (x: string | null) => { v = x ?? ''; } }; };

function page(relay: FakeRelay, name: string, shown: GameController[], store = device()) {
  const s = new OnlineSession({
    connect: relay.connect, name: () => name, baseSettings: () => ({ ...DEFAULT_SETTINGS, firstSeat: 0 }),
    show: c => shown.push(c), wait: () => Promise.resolve(), rejoinStore: store,
  });
  sessions.push(s);
  return s;
}

/** Keep the game moving on one device: tap OK on turn banners, answer questions, end the turn. */
function autoplay(get: () => GameController | undefined) {
  let on = true;
  const loop = async () => {
    while (on) {
      const c = get(), sn = c?.snapshot.get();
      if (c && sn) {
        if (sn.passTo !== null) c.ready();
        else if (sn.prompt) sn.prompt.answer(fallbackAnswer(sn.prompt.decision));
        else if (sn.turnBanner === sn.viewer) c.turnOk();
        else if (sn.view && !sn.view.over && sn.view.turn === sn.viewer && c.api?.resting) void c.act({ type: 'endTurn' });
      }
      await new Promise(r => setTimeout(r, 15));
    }
  };
  void loop();
  return () => { on = false; };
}

async function threePlayers() {
  const relay = new FakeRelay();
  const hanaStore = device();
  const hanaShown: GameController[] = [], gusShown: GameController[] = [], gailShown: GameController[] = [];
  const hana = page(relay, 'Hana', hanaShown, hanaStore), gus = page(relay, 'Gus', gusShown), gail = page(relay, 'Gail', gailShown);
  await hana.hostRoom();
  await gus.join(hana.state.get().code);
  await gail.join(hana.state.get().code);
  await until(() => hana.state.get().players.length === 3);
  void hana.start(9);
  await until(() => gusShown.length === 1 && gailShown.length === 1);
  return { relay, hana, gus, gail, hanaStore, hanaShown, gusShown, gailShown };
}

describe('the host leaving a running game', () => {
  it('another player hosts, a bot plays for the host, and the host gets it all back on returning', async () => {
    const { relay, hana, gus, gail, hanaStore, hanaShown, gusShown, gailShown } = await threePlayers();
    const stops = [autoplay(() => hanaShown.at(-1)), autoplay(() => gusShown.at(-1)), autoplay(() => gailShown.at(-1))];
    try {
      // Let the backup reach the heir (Gus, the lowest seat), then the host's page closes
      await until(() => (hanaShown[0]!.state?.turnCount ?? 0) >= 3);
      hana.pageClosing();

      await until(() => gus.state.get().role === 'host');
      const gusHost = gusShown.at(-1)!;
      expect(gusHost).not.toBe(gusShown[0]);                    // Gus's device runs the game now
      await until(() => !!gusHost.state?.seats[0]?.standIn);   // a bot plays Hana's cards
      expect(gail.state.get().phase).toBe('playing');           // Gail never noticed more than a moment
      expect(gail.state.get().error).toBe('');

      // The game goes on: Gail is still dealt turns from the new host
      const turns = gusHost.state!.turnCount;
      await until(() => gusHost.state!.turnCount >= turns + 3);
      expect(gailShown[0]!.snapshot.get().view!.turnCount).toBeGreaterThan(turns);

      // Hana's page opens again: she's back in her seat, and hosting again
      const hanaAgain: GameController[] = [];
      stops.push(autoplay(() => hanaAgain.at(-1)));
      const back = page(relay, 'Hana', hanaAgain, hanaStore);
      expect(back.autoRejoinable()).toBe(true);
      await back.rejoin();
      await until(() => back.state.get().role === 'host' && gus.state.get().role === 'client');
      const hanaHost = hanaAgain.at(-1)!;
      await until(() => hanaHost.state?.seats[0]?.bot === null && !hanaHost.state.seats[0]!.standIn);
      const turns2 = hanaHost.state!.turnCount;
      await until(() => hanaHost.state!.turnCount >= turns2 + 3);
      expect(gusShown.at(-1)!.snapshot.get().view!.turnCount).toBeGreaterThan(turns2);    // Gus plays on, as a player
      expect(gailShown[0]!.snapshot.get().view!.turnCount).toBeGreaterThan(turns2);
    } finally {
      for (const stop of stops) stop();
    }
  }, 20000);

  it('with nobody left to take over, the game ends as before', async () => {
    const relay = new FakeRelay();
    const shown: GameController[] = [];
    const hana = page(relay, 'Hana', []), gus = page(relay, 'Gus', shown);
    await hana.hostRoom();
    await gus.join(hana.state.get().code);
    await until(() => hana.state.get().players.length === 2);
    hana.leave();                                             // still in the lobby: no game to carry on
    await until(() => gus.state.get().phase === 'ended');
    expect(gus.state.get().error).toBe('The host left the game.');
  });
});
