import { describe, expect, it, vi } from 'vitest';
import { SERVER, fakeApi, makeStore, signIn } from '../account/test-fakes';
import type { GoldCode } from './codes';
import { Entitlements } from './entitlements';
import { GoldService } from './gold';
import { TrialWatcher } from './trial-watch';

const NOW = Date.UTC(2026, 9, 27), SEC = NOW / 1000, DAY = 86400;

// Fake verifier: "good-<kind>-<exp>" codes are valid
const verify = async (c: string): Promise<GoldCode | null> => {
  const m = /^good-(\w+)-(\d+)$/.exec(c.trim());
  return m ? { kind: m[1], exp: Number(m[2]), _code: c.trim() } : null;
};

function setup(replies: Record<string, unknown> = {}, signedIn = true) {
  const { store } = makeStore();
  if (signedIn) signIn(store);
  const ent = new Entitlements(store, () => NOW);
  const { api, calls } = fakeApi(replies);
  return { store, ent, calls, gold: new GoldService(store, ent, api, verify, () => NOW) };
}

describe('GoldService', () => {
  it('check keeps good codes, drops bad ones and picks up ?gold=', async () => {
    const { store, ent, gold } = setup();
    store.setJson('codes', ['good-gold-0', 'broken']);
    expect(await gold.check('?gold=good-pack-0')).toBe('yes');
    expect(gold.codes()).toEqual(['good-gold-0', 'good-pack-0']);
    expect(ent.live()).toHaveLength(2);
  });

  it('enter: invalid, expired, pack, ok', async () => {
    const { gold } = setup();
    expect(await gold.enter('nope')).toBe('invalid');
    expect(await gold.enter('good-gold-' + (SEC - 10))).toBe('expired');
    expect(await gold.enter('good-pack-0')).toBe('pack');
    expect(await gold.enter('good-gold-0')).toBe('ok');
    expect(gold.codes()).toEqual(['good-pack-0', 'good-gold-0']);
  });

  it('sync merges codes from the server', async () => {
    const { gold, calls } = setup({ '/account': { codes: ['good-gold-0'], trialUsed: true } });
    expect(await gold.sync(SERVER)).toBe('ok-trialused');
    expect(calls[0]!.body).toMatchObject({ id_token: 'tok', codes: [] });
    expect(gold.codes()).toEqual(['good-gold-0']);
  });

  it('sync reports a signed-out player, no server and an expired login', async () => {
    expect(await setup({}, false).gold.sync(SERVER)).toBe('signedout');
    expect(await setup({}).gold.sync(SERVER)).toBe('noserver');
    expect(await setup({ '/account': { error: 'login' } }).gold.sync(SERVER)).toBe('login');
  });

  it('trial on the server', async () => {
    const { ent, gold } = setup({ '/trial': { gold: { plan: 'trial', exp: SEC + 7 * DAY }, packs: [] } });
    expect(await gold.startTrialAny(SERVER)).toBe('ok');
    expect(ent.goldInfo()).toMatch(/^Free trial, 7 days left/);
  });

  it('trial on this device: once per email', async () => {
    const { ent, gold } = setup();
    expect(await gold.startTrialAny('')).toBe('ok');
    expect(ent.trialRecord()?.exp).toBe(SEC + 7 * DAY);
    expect(await gold.startTrialAny('')).toBe('used');
    expect(await setup({}, false).gold.startTrialAny('')).toBe('signin');
  });

  it('the old code-based trial ends "invalid" against today\'s server', async () => {
    const { gold } = setup({ '/trial': { packs: [], trialUsed: true } });
    expect(await gold.startTrialCode(SERVER)).toBe('invalid');
  });

  it('free packs: local once per user, or through the server', async () => {
    const local = setup();
    expect(await local.gold.claimFree('p', 'Alex@x.com', '')).toBe('ok');
    expect(await local.gold.claimFree('p', 'alex@x.com', '')).toBe('used');
    expect(local.ent.ownsPack('p')).toBe(true);
    expect(await local.gold.claimFree('p', '', '')).toBe('signin');

    const srv = setup({ '/claim-pack': (b: { pack: string }) => ({ packs: [b.pack] }) });
    expect(await srv.gold.claimFree('q', 'a', SERVER)).toBe('ok');
    expect(srv.ent.ownsPack('q')).toBe(true);
    expect(srv.ent.freeClaimed('q', 'someone-else')).toBe(true);
  });
});

describe('TrialWatcher', () => {
  function watch(now: number, running = false) {
    const { store } = makeStore();
    signIn(store);
    const ent = new Entitlements(store, () => now);
    const hooks = { isGameRunning: () => running, showCountdown: vi.fn(), showEnded: vi.fn(), onEnded: vi.fn() };
    return { store, ent, hooks, w: new TrialWatcher(store, ent, hooks, () => now) };
  }

  it('shows the countdown once per day', () => {
    const { ent, hooks, w } = watch(NOW);
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC + 2 * DAY, src: 'local' });
    w.tick(true); w.tick(true);
    expect(hooks.showCountdown).toHaveBeenCalledTimes(1);
    expect(hooks.showCountdown).toHaveBeenCalledWith('Gold free trial: 2 days left');
  });

  it('waits while a game is running', () => {
    const { ent, hooks, w } = watch(NOW, true);
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC + DAY, src: 'local' });
    w.tick(true);
    expect(hooks.showCountdown).not.toHaveBeenCalled();
  });

  it('says the trial ended once, and reloads cosmetics only when live', () => {
    const { ent, hooks, w } = watch(NOW);
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC - 10, src: 'local' });
    w.tick(false);
    w.tick(true);
    expect(hooks.showEnded).toHaveBeenCalledTimes(1);
    expect(hooks.onEnded).not.toHaveBeenCalled();
  });

  it('stays quiet when other Gold is still active', () => {
    const { ent, hooks, w } = watch(NOW);
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC - 10, src: 'local' });
    ent.addPaid({ kind: 'gold', id: 'lifetime', exp: 0, src: 'local' });
    w.tick(true);
    expect(hooks.showEnded).not.toHaveBeenCalled();
  });
});
