import { isError, isServerUrl, type Entitlements as ServerEntitlements, type ServerApi } from '../account/api';
import { verifiedUser } from '../account/user';
import type { Entitlements } from '../gold/entitlements';
import type { SaveStore } from '../storage';
import type { Checkout } from './paypal';

export interface PriceInfo {
  price: number;
  currency: string;
  clientId: string;   // PayPal client id from game-settings.json; empty = test mode
  server: string;     // game server URL; empty = this device only
}

export type BuyResult = 'ok' | 'cancel' | 'error' | `server-${string}`;

const PAYPAL_AUTOPAY = 'https://www.paypal.com/myaccount/autopay/';

// Buying Gold, packs and donations. The server double-checks every payment with PayPal.
export class Purchases {
  constructor(
    private readonly store: SaveStore,
    private readonly ent: Entitlements,
    private readonly api: ServerApi,
    private readonly checkout: Checkout,
    private readonly addSpent: (amount: number) => void,         // the "spent" leaderboard
    private readonly openWindow: (url: string) => void = url => { window.open(url, '_blank'); },
  ) {}

  private useServer(server: string) { return !!verifiedUser(this.store) && isServerUrl(server); }

  // kind "gold" (id lifetime/month/year), "pack" (id = pack id) or "donate"
  async payItem(kindIn: string, id: string, p: PriceInfo, title = ''): Promise<BuyResult> {
    const kind = ['pack', 'donate'].includes(kindIn) ? kindIn : 'gold';
    const names: Record<string, string> = { lifetime: 'Lifetime Gold', month: '30 days of Gold', year: '1 year of Gold' };
    const name = kind === 'gold' ? (names[id] || 'Gold') : kind === 'donate' ? 'Donation to support Build That Wall' : (title || id);
    const res = await this.checkout({ title: name, price: p.price, currency: p.currency, clientId: p.clientId, customId: kind + ':' + id });
    if (res.status !== 'ok') return res.status;
    this.addSpent(p.price);
    if (kind === 'donate') {                                   // thank you! nothing to unlock
      if (this.useServer(p.server)) void this.api.call(p.server, '/paypal/confirm', { orderID: res.id, item: 'donate:donation' });
      return 'ok';
    }
    if (this.useServer(p.server)) {                            // the server double-checks the payment with PayPal
      const r = await this.api.call<ServerEntitlements>(p.server, '/paypal/confirm', { orderID: res.id, item: kind + ':' + id });
      if (r && !isError(r)) { this.ent.applyServer(r); return 'ok'; }
      if (r && isError(r)) return `server-${r.error}`;
    }
    // NOTE: with no server (or no answer from it) the purchase is only remembered on this device
    this.ent.addPaid({ kind, id, exp: kind === 'gold' ? this.ent.planExp(id) : 0, order: res.id, src: 'local' });
    return 'ok';
  }

  // Gold that renews every month or year. Without a PayPal plan id it falls back to a one-off payment.
  async paySub(planIn: string, planId: string, p: PriceInfo): Promise<BuyResult> {
    const plan = planIn === 'year' ? 'year' : 'month';
    planId = String(planId || '').trim();
    if (!planId) return this.payItem('gold', plan, p);
    const title = plan === 'year' ? 'Gold, renews every year' : 'Gold, renews every month';
    const res = await this.checkout({ title, price: p.price, currency: p.currency, clientId: p.clientId, customId: 'gold:' + plan, planId });
    if (res.status !== 'ok') return res.status;
    this.addSpent(p.price);
    if (this.useServer(p.server)) {
      const r = await this.api.call<ServerEntitlements>(p.server, '/paypal/subscribed', { subscriptionID: res.id, plan });
      if (r && !isError(r)) { this.ent.applyServer(r); return 'ok'; }
      if (r && isError(r)) return `server-${r.error}`;
    }
    this.ent.addPaid({ kind: 'gold', id: plan, exp: this.ent.planExp(plan), sub: res.id, renews: true, src: 'local' });
    return 'ok';
  }

  // Stop a renewing plan
  async endPayment(server: string): Promise<string> {
    if (this.useServer(server)) {
      const r = await this.api.call<ServerEntitlements>(server, '/paypal/cancel', {});
      if (!r) return 'noserver'; if (isError(r)) return r.error;
      this.ent.applyServer(r); return 'ok';
    }
    // no game server: stop it on PayPal's own page, and remember it here
    const l = this.ent.paidAll().map(p => (p.renews ? { ...p, cancelled: true } : p));
    this.store.setJson('paid', l);
    try { this.openWindow(PAYPAL_AUTOPAY); } catch { /* pop-up blocked */ }
    return 'paypal';
  }
}
