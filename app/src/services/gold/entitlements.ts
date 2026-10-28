import type { Entitlements as ServerEntitlements } from '../account/api';
import { isSignedIn } from '../account/user';
import { ACCOUNT_KEY_RE, type SaveStore } from '../storage';
import type { GoldCode } from './codes';

const DAY = 86400;

// One thing the player has, saved in "btw:paid"
export interface PaidRecord {
  kind?: 'gold' | 'pack' | 'donate' | string;  // missing = gold (older saves)
  id: string;                                 // gold: lifetime/month/year/trial/gold; pack: its id
  exp?: number;                               // seconds since 1970; 0 = never ends
  src: 'local' | 'server';
  order?: string;
  sub?: string;
  renews?: boolean;
  cancelled?: boolean;
  free?: boolean;
}

export type Clock = () => number;   // milliseconds, like Date.now

// What the player has unlocked: Gold codes, purchases on this device, and what the server confirmed
export class Entitlements {
  private codes: GoldCode[] = [];
  isOwner = false;     // the owner gets everything
  testGold = false;    // owner tool: pretend to have Gold

  constructor(private readonly store: SaveStore, private readonly now: Clock = Date.now) {}

  private nowSec() { return this.now() / 1000; }

  // Gold codes that checked out, set by GoldService.check()
  setCodes(list: GoldCode[]) { this.codes = list; }

  // Codes that haven't ended
  live(): GoldCode[] { const now = this.nowSec(); return this.codes.filter(p => !p.exp || p.exp > now); }

  paidAll(): PaidRecord[] { return this.store.getJson<PaidRecord[]>('paid', []); }

  // Gold purchases that haven't ended
  paid(): PaidRecord[] {
    const now = this.nowSec();
    return this.paidAll().filter(p => (p.kind || 'gold') === 'gold' && (!p.exp || p.exp > now));
  }

  // A new server record replaces the older server record for the same thing
  addPaid(rec: PaidRecord): void {
    const l = this.paidAll().filter(p => !(rec.src === 'server' && p.src === 'server' && p.kind === rec.kind && p.id === rec.id));
    l.push(rec);
    this.store.setJson('paid', l);
  }

  planExp(plan: string): number {
    const now = Math.floor(this.nowSec());
    return plan === 'month' ? now + 30 * DAY : plan === 'year' ? now + 365 * DAY : plan === 'trial' ? now + 7 * DAY : 0;
  }

  // Entitlements the server confirmed: they replace every earlier server record
  applyServer(r: ServerEntitlements | null | undefined): void {
    if (!r) return;
    const l = this.paidAll().filter(p => p.src !== 'server');
    if (r.gold && (r.gold.exp === 0 || r.gold.exp > this.nowSec())) {
      l.push({ kind: 'gold', id: r.gold.plan || 'gold', exp: r.gold.exp, src: 'server', renews: !!r.gold.sub, cancelled: !!r.gold.cancelled });
    }
    for (const id of (r.packs || [])) l.push({ kind: 'pack', id, src: 'server' });
    this.store.setJson('paid', l);
    if (r.data) for (const k in r.data) if (ACCOUNT_KEY_RE.test(k)) this.store.set(k, r.data[k]);
  }

  ownsPack(id: string): boolean {
    if (this.isOwner) return true;
    return isSignedIn(this.store) && this.paidAll().some(p => p.kind === 'pack' && p.id === String(id));
  }

  goldActive(): boolean {
    if (this.testGold || this.isOwner) return true;
    // NOTE: a valid Gold code or purchase only counts while signed in
    if (!isSignedIn(this.store)) return false;
    return this.live().some(p => p.kind === 'gold') || this.paid().length > 0;
  }

  goldRenews(): boolean { return this.paid().some(p => p.renews && !p.cancelled); }

  daysLeft(exp: number): number { return Math.max(0, Math.ceil((exp * 1000 - this.now()) / 86400000)); }

  // The newest free-trial record, or null
  trialRecord(): PaidRecord | null {
    return this.paidAll().filter(p => (p.kind || 'gold') === 'gold' && p.id === 'trial' && p.exp)
      .sort((x, y) => (y.exp ?? 0) - (x.exp ?? 0))[0] || null;
  }

  // One line for the Gold menu
  goldInfo(): string {
    if (this.testGold) return 'Gold (test mode)';
    const g: { exp?: number; id?: string }[] = [...this.live().filter(p => p.kind === 'gold'), ...this.paid()];
    if (!g.length) return '';
    if (g.some(p => !p.exp)) return 'Lifetime Gold';
    const end = Math.max(...g.map(p => p.exp!)), day = new Date(end * 1000).toISOString().slice(0, 10);
    const left = this.daysLeft(end), dl = left + (left === 1 ? ' day' : ' days') + ' left';
    if (this.goldRenews()) return 'Gold, renews on ' + day;
    if (g.every(p => p.id === 'trial')) return 'Free trial, ' + dl + ' (ends ' + day + ')';
    return 'Gold until ' + day + ' (' + dl + ')';
  }

  // need: "free", "gold" or "pack:<id>"
  unlocked(need: string): boolean {
    need = String(need);
    if (need === 'free' || need === '') return true;
    if (need === 'gold') return this.goldActive();
    if (need.startsWith('pack:')) {
      const n = need.slice(5);
      // NOTE: only pack codes count here, not bought packs in "paid" (ownsPack checks those)
      return this.testGold || this.live().some(p => (p.packs || []).includes(n));
    }
    return false;
  }

  // ---- free packs
  freeClaimed(id: string, user: string): boolean {
    const c = this.store.getJson<Record<string, number>>('freeclaims', {});
    return !!c[String(id) + ':' + String(user).toLowerCase()] || !!c['server:' + String(id)];
  }

  markFreeClaimed(key: string): void {
    const c = this.store.getJson<Record<string, number>>('freeclaims', {});
    c[key] = 1;
    this.store.setJson('freeclaims', c);
  }
}
