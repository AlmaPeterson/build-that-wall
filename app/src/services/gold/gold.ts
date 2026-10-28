import { isError, isServerUrl, type Entitlements as ServerEntitlements, type ServerApi } from '../account/api';
import { getUser, verifiedUser } from '../account/user';
import type { SaveStore } from '../storage';
import { verifyGoldCode, type GoldCode } from './codes';
import type { Entitlements } from './entitlements';

export type Verifier = (code: string) => Promise<GoldCode | null>;

// Gold codes, the free trial and free packs
export class GoldService {
  constructor(
    private readonly store: SaveStore,
    private readonly ent: Entitlements,
    private readonly api: ServerApi,
    private readonly verify: Verifier = c => verifyGoldCode(c),
    private readonly now: () => number = Date.now,
  ) {}

  codes(): string[] { return this.store.getJson<string[]>('codes', []); }

  // Re-check every saved code (plus ?gold=CODE from the payment page) and keep only the good ones.
  // The caller starts the TrialWatcher afterwards.
  async check(urlSearch = ''): Promise<'yes' | 'no'> {
    const list = this.codes();
    try {
      const q = new URLSearchParams(urlSearch).get('gold');
      if (q && !list.includes(q)) list.push(q);
    } catch { /* bad query string */ }
    const good: string[] = [], valid: GoldCode[] = [];
    for (const c of list) { const p = await this.verify(c); if (p) { good.push(c); valid.push(p); } }
    this.store.setJson('codes', good);
    this.ent.setCodes(valid);
    return this.ent.goldActive() ? 'yes' : 'no';
  }

  // A code the player typed in
  async enter(code: string): Promise<'invalid' | 'expired' | 'pack' | 'ok'> {
    const p = await this.verify(code);
    if (!p) return 'invalid';
    if (p.exp && p.exp < this.now() / 1000) return 'expired';
    const list = this.codes(); if (!list.includes(p._code)) list.push(p._code);
    this.store.setJson('codes', list);
    await this.check();
    return p.kind === 'pack' ? 'pack' : 'ok';
  }

  // Codes from other devices: the server keeps a copy of this account's codes
  async sync(server: string): Promise<string> {
    if (!getUser(this.store)) return 'signedout';
    const r = await this.api.call<{ codes?: string[]; trialUsed?: boolean }>(server, '/account', { codes: this.codes() });
    if (!r) return 'noserver';
    if (isError(r)) return r.error;                  // "login" = token expired, sign in again
    const list = this.codes(); for (const c of (r.codes || [])) if (!list.includes(c)) list.push(c);
    this.store.setJson('codes', list);
    await this.check();
    return r.trialUsed ? 'ok-trialused' : 'ok';
  }

  // The 7-day free trial: on the server when signed in, otherwise once per email on this device
  async startTrialAny(server: string, user = ''): Promise<string> {
    if (verifiedUser(this.store) && isServerUrl(server)) {
      const r = await this.api.call<ServerEntitlements>(server, '/trial', {});
      if (!r) return 'noserver'; if (isError(r)) return r.error;
      this.ent.applyServer(r); return 'ok';
    }
    const who = String(getUser(this.store)?.email || this.store.get('gemail') || user || '').trim().toLowerCase();
    if (!who) return 'signin';
    const used = this.store.getJson<string[]>('trials', []);
    if (used.includes(who)) return 'used';
    used.push(who); this.store.setJson('trials', used);
    this.ent.addPaid({ kind: 'gold', id: 'trial', exp: this.ent.planExp('trial'), src: 'local' });
    return 'ok';
  }

  // Older trial flow that expected the server to send back a Gold code
  async startTrialCode(server: string): Promise<string> {
    if (!getUser(this.store)) return 'signin';
    const r = await this.api.call<{ code?: string }>(server, '/trial', {});
    if (!r) return 'noserver';
    if (isError(r)) return r.error;
    // NOTE: game-server.gs /trial returns entitlements, not {code}, so this always ends "invalid".
    // Use startTrialAny instead.
    return await this.enter(String((r as { code?: string }).code));
  }

  // A pack the owner gives away (FREE_PACKS on the server)
  async claimFree(id: string, user: string, server: string): Promise<string> {
    id = String(id); const who = String(user || '').toLowerCase();
    if (verifiedUser(this.store) && isServerUrl(server)) {
      const r = await this.api.call<ServerEntitlements>(server, '/claim-pack', { pack: id });
      if (!r) return 'noserver'; if (isError(r)) return r.error;
      this.ent.applyServer(r); this.ent.markFreeClaimed('server:' + id);
      return 'ok';
    }
    if (!who) return 'signin';
    if (this.store.getJson<Record<string, number>>('freeclaims', {})[id + ':' + who]) return 'used';
    this.ent.markFreeClaimed(id + ':' + who);
    this.ent.addPaid({ kind: 'pack', id, free: true, src: 'local' });
    return 'ok';
  }
}
