import { loadScript, type ScriptLoader } from '../account/script-loader';

// ---- checkout: PayPal smart buttons (PayPal, Pay Later, Venmo, debit or credit card)

export interface CheckoutRequest {
  title: string;          // shown to the player, e.g. "Lifetime Gold"
  price: number;
  currency: string;
  clientId: string;       // empty or "test" = PayPal sandbox test mode
  customId: string;       // "gold:lifetime", "pack:<id>", "donate:donation"; the server checks it
  planId?: string;        // a PayPal plan id makes it a subscription
}

export type CheckoutResult =
  | { status: 'ok'; id: string; sub?: boolean; test: boolean }
  | { status: 'cancel' }
  | { status: 'error' };

export type Checkout = (req: CheckoutRequest) => Promise<CheckoutResult>;

// The bits of the PayPal JS SDK we use
interface PayPalActions {
  order: { create(o: unknown): Promise<string>; capture(): Promise<{ id: string; status: string }> };
  subscription: { create(o: unknown): Promise<string> };
}
interface PayPalSdk { Buttons(opts: Record<string, unknown>): { render(el: HTMLElement): void } }
type PayPalWindow = Window & { paypal?: PayPalSdk };

export class PayPalCheckout {
  private src = '';
  private tag: HTMLScriptElement | null = null;

  constructor(private readonly load: ScriptLoader = loadScript) {}

  // One SDK per client id + currency + mode; switching reloads it
  private async loadSdk(cid: string, cur: string, sub: boolean): Promise<PayPalSdk> {
    const w = window as PayPalWindow;
    const src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(cid) + '&currency=' + cur +
      (sub ? '&vault=true&intent=subscription' : '&intent=capture&enable-funding=venmo,card');
    if (w.paypal && this.src === src) return w.paypal;
    if (this.tag) { this.tag.remove(); w.paypal = undefined; }
    this.tag = await this.load(src, { 'data-namespace': 'paypal' });
    this.src = src;
    if (!w.paypal) throw new Error('paypal');
    return w.paypal;
  }

  readonly checkout: Checkout = (req) => {
    if (typeof document === 'undefined') return Promise.resolve({ status: 'error' });
    const cid = String(req.clientId || '').trim() || 'test';
    const test = cid === 'test';
    const cur = (String(req.currency || 'USD').toUpperCase().replace(/[^A-Z]/g, '') || 'USD').slice(0, 3);
    const price = (Math.round((+req.price || 0.99) * 100) / 100).toFixed(2);
    const planName = req.title, planId = req.planId, customId = req.customId;
    return new Promise(res => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;padding:20px 22px;border-radius:14px;font:15px Arial;width:min(92vw,420px);max-height:92vh;overflow:auto;text-align:center;';
      // NOTE: planName goes into innerHTML unescaped, as before; titles come from the game, not players
      box.innerHTML = "<div style='font-weight:bold;font-size:20px;color:#9c7a12'>Build That Wall</div>" +
        "<div style='margin:6px 0 2px;font-size:16px'>" + planName + ': <b>' + price + ' ' + cur + '</b></div>' +
        "<div style='color:#666;font-size:13px;margin-bottom:10px'>Pay with PayPal, Venmo, or a debit / credit card.</div>" +
        (planId ? "<div style='color:#666;font-size:12px;margin-bottom:8px'>Renews automatically. Stop any time with End payment in the Gold menu.</div>" : '') +
        (test ? "<div style='background:#fff3cd;border:1px solid #c9a227;border-radius:8px;padding:6px;margin-bottom:10px;font-size:12px'>TEST MODE: no real money is taken. The owner adds a PayPal client ID to sell for real.</div>" : '');
      const holder = document.createElement('div'); holder.style.cssText = 'min-height:150px';
      const note = document.createElement('div'); note.style.cssText = 'color:#b3122a;font-size:13px;margin-top:6px;min-height:16px';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
      cancel.style.cssText = 'margin-top:10px;padding:8px 20px;border:1px solid #aaa;background:#f4f4f4;border-radius:8px;cursor:pointer;font-size:14px';
      box.append(holder, note, cancel); wrap.appendChild(box); document.body.appendChild(wrap);
      let done = false;
      const finish = (v: CheckoutResult) => { if (done) return; done = true; wrap.remove(); res(v); };
      cancel.onclick = () => finish({ status: 'cancel' });
      holder.textContent = 'Loading secure checkout...';
      const failed = () => { note.textContent = 'Something went wrong with the payment. Please try again.'; };
      this.loadSdk(cid, cur, !!planId).then(paypal => {
        holder.textContent = '';
        if (planId) {                                  // automatic renewals (PayPal subscription)
          paypal.Buttons({
            style: { layout: 'vertical', shape: 'rect', label: 'subscribe' },
            createSubscription: (_d: unknown, act: PayPalActions) => act.subscription.create({ plan_id: planId, custom_id: customId }),
            onApprove: (d: { subscriptionID: string }) => finish({ status: 'ok', id: d.subscriptionID, sub: true, test }),
            onError: failed,
          }).render(holder);
          return;
        }
        paypal.Buttons({
          style: { layout: 'vertical', shape: 'rect', label: 'pay' },
          createOrder: (_d: unknown, act: PayPalActions) => act.order.create({
            purchase_units: [{ amount: { currency_code: cur, value: price }, description: 'Build That Wall: ' + planName, custom_id: customId }],
            application_context: { shipping_preference: 'NO_SHIPPING', brand_name: 'Build That Wall' } }),
          onApprove: (_d: unknown, act: PayPalActions) => act.order.capture().then(det => {
            if (det && det.status === 'COMPLETED') finish({ status: 'ok', id: det.id, test });
            else note.textContent = 'The payment was not completed. Please try again.';
          }).catch(() => { note.textContent = 'The payment did not go through. Please try again.'; }),
          onError: failed,
        }).render(holder);
      }).catch(() => { holder.textContent = 'Could not load the checkout. Check your internet and try again.'; });
    });
  };
}
