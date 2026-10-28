import { describe, expect, it } from 'vitest';
import { makeStore, signIn } from '../account/test-fakes';
import type { GoldCode } from './codes';
import { Entitlements } from './entitlements';

const NOW = Date.UTC(2026, 9, 27) ;          // 2026-10-27
const SEC = NOW / 1000, DAY = 86400;

function setup(signedIn = true) {
  const { store } = makeStore();
  if (signedIn) signIn(store);
  const ent = new Entitlements(store, () => NOW);
  return { store, ent };
}

describe('Entitlements', () => {
  it('Gold only counts while signed in', () => {
    const { store, ent } = setup(false);
    ent.addPaid({ kind: 'gold', id: 'lifetime', exp: 0, src: 'local' });
    expect(ent.goldActive()).toBe(false);
    store.set('gname', 'Alex');               // older pop-up sign-in counts too
    expect(ent.goldActive()).toBe(true);
  });

  it('owner and test mode always have Gold', () => {
    const { ent } = setup(false);
    ent.isOwner = true;
    expect(ent.goldActive()).toBe(true);
    expect(ent.ownsPack('anything')).toBe(true);
  });

  it('expired purchases and codes stop counting', () => {
    const { ent } = setup();
    ent.addPaid({ kind: 'gold', id: 'month', exp: SEC - 1, src: 'local' });
    expect(ent.goldActive()).toBe(false);
    ent.setCodes([{ kind: 'gold', exp: SEC - 1, _code: 'a' }]);
    expect(ent.goldActive()).toBe(false);
    ent.setCodes([{ kind: 'gold', exp: SEC + 60, _code: 'b' }]);
    expect(ent.goldActive()).toBe(true);
  });

  it('records with no kind are Gold (older saves)', () => {
    const { ent } = setup();
    ent.addPaid({ id: 'year', exp: SEC + DAY, src: 'local' });
    expect(ent.paid()).toHaveLength(1);
  });

  it('plan lengths', () => {
    const { ent } = setup();
    expect(ent.planExp('month')).toBe(SEC + 30 * DAY);
    expect(ent.planExp('year')).toBe(SEC + 365 * DAY);
    expect(ent.planExp('trial')).toBe(SEC + 7 * DAY);
    expect(ent.planExp('lifetime')).toBe(0);
  });

  it('a new server record replaces the old one; local records are kept', () => {
    const { ent } = setup();
    ent.addPaid({ kind: 'gold', id: 'year', exp: SEC + DAY, src: 'server' });
    ent.addPaid({ kind: 'gold', id: 'year', exp: SEC + 2 * DAY, src: 'server' });
    ent.addPaid({ kind: 'gold', id: 'year', exp: SEC + 3 * DAY, src: 'local' });
    expect(ent.paidAll().map(p => p.exp)).toEqual([SEC + 2 * DAY, SEC + 3 * DAY]);
  });

  describe('applyServer', () => {
    it('replaces every server record and keeps local ones', () => {
      const { ent } = setup();
      ent.addPaid({ kind: 'pack', id: 'old', src: 'server' });
      ent.addPaid({ kind: 'pack', id: 'bought-here', src: 'local' });
      ent.applyServer({ packs: ['halloween'], gold: { plan: 'year', exp: SEC + DAY, sub: 'I-1' } });
      expect(ent.paidAll()).toEqual([
        { kind: 'pack', id: 'bought-here', src: 'local' },
        { kind: 'gold', id: 'year', exp: SEC + DAY, src: 'server', renews: true, cancelled: false },
        { kind: 'pack', id: 'halloween', src: 'server' },
      ]);
      expect(ent.ownsPack('halloween')).toBe(true);
      expect(ent.goldRenews()).toBe(true);
    });

    it('keeps Lifetime Gold (exp 0) and drops expired Gold', () => {
      const { ent } = setup();
      ent.applyServer({ gold: { plan: 'lifetime', exp: 0 } });
      expect(ent.goldInfo()).toBe('Lifetime Gold');
      ent.applyServer({ gold: { plan: 'month', exp: SEC - 5 } });
      expect(ent.paidAll()).toEqual([]);
    });

    it('copies only account keys from saved data', () => {
      const { store, ent } = setup();
      ent.applyServer({ data: { name: 'Sam', stat_wins: '4', user: 'hack', codes: '[]' } });
      expect(store.get('name')).toBe('Sam');
      expect(store.get('stat_wins')).toBe('4');
      expect(JSON.parse(store.get('user')).name).toBe('Alex');
      expect(store.get('codes')).toBe('');
    });

    it('ignores an empty reply', () => {
      const { ent } = setup();
      ent.addPaid({ kind: 'pack', id: 'x', src: 'server' });
      ent.applyServer(null);
      expect(ent.paidAll()).toHaveLength(1);
    });
  });

  describe('goldInfo', () => {
    it('describes each kind of Gold', () => {
      const { ent } = setup();
      expect(ent.goldInfo()).toBe('');
      ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC + 3 * DAY, src: 'local' });
      expect(ent.goldInfo()).toBe('Free trial, 3 days left (ends 2026-10-30)');
      ent.addPaid({ kind: 'gold', id: 'year', exp: SEC + DAY, src: 'local' });
      expect(ent.goldInfo()).toBe('Gold until 2026-10-30 (3 days left)');
      ent.addPaid({ kind: 'gold', id: 'month', exp: SEC + 10 * DAY, src: 'local', renews: true });
      expect(ent.goldInfo()).toBe('Gold, renews on 2026-11-06');
      ent.testGold = true;
      expect(ent.goldInfo()).toBe('Gold (test mode)');
    });

    it('says 1 day, not 1 days', () => {
      const { ent } = setup();
      ent.addPaid({ kind: 'gold', id: 'year', exp: SEC + 3600, src: 'local' });
      expect(ent.goldInfo()).toBe('Gold until 2026-10-27 (1 day left)');
    });
  });

  it('unlocked: free, gold and pack codes', () => {
    const { ent } = setup();
    expect(ent.unlocked('free')).toBe(true);
    expect(ent.unlocked('')).toBe(true);
    expect(ent.unlocked('gold')).toBe(false);
    expect(ent.unlocked('pack:x')).toBe(false);
    ent.setCodes([{ kind: 'pack', packs: ['x'], _code: 'c' } as GoldCode]);
    expect(ent.unlocked('pack:x')).toBe(true);
    expect(ent.unlocked('weird')).toBe(false);
  });

  it('trial record is the newest trial', () => {
    const { ent } = setup();
    expect(ent.trialRecord()).toBeNull();
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC + DAY, src: 'local' });
    ent.addPaid({ kind: 'gold', id: 'trial', exp: SEC + 5 * DAY, src: 'server' });
    expect(ent.trialRecord()?.exp).toBe(SEC + 5 * DAY);
  });

  it('free claims by user or from the server', () => {
    const { ent } = setup();
    expect(ent.freeClaimed('p', 'Alex@x.com')).toBe(false);
    ent.markFreeClaimed('p:alex@x.com');
    expect(ent.freeClaimed('p', 'Alex@x.com')).toBe(true);
    ent.markFreeClaimed('server:q');
    expect(ent.freeClaimed('q', 'anyone')).toBe(true);
  });
});
