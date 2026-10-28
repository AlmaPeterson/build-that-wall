import { describe, expect, it, vi } from 'vitest';
import { SERVER, fakeApi, makeStore, signIn } from '../account/test-fakes';
import { Entitlements } from '../gold/entitlements';
import type { Checkout, CheckoutResult } from './paypal';
import { Purchases } from './purchases';

const price = (server = '') => ({ price: 9.99, currency: 'USD', clientId: '', server });

function setup(result: CheckoutResult, replies: Record<string, unknown> = {}) {
  const { store } = makeStore();
  signIn(store);
  const ent = new Entitlements(store);
  const { api, calls } = fakeApi(replies);
  const checkout = vi.fn<Checkout>(async () => result);
  const addSpent = vi.fn();
  const openWindow = vi.fn();
  return { store, ent, calls, checkout, addSpent, openWindow, buy: new Purchases(store, ent, api, checkout, addSpent, openWindow) };
}

describe('Purchases', () => {
  it('cancelled checkout unlocks nothing', async () => {
    const { ent, addSpent, buy } = setup({ status: 'cancel' });
    expect(await buy.payItem('gold', 'lifetime', price())).toBe('cancel');
    expect(ent.paidAll()).toEqual([]);
    expect(addSpent).not.toHaveBeenCalled();
  });

  it('without a server, Lifetime Gold is remembered on this device', async () => {
    const { ent, checkout, addSpent, buy } = setup({ status: 'ok', id: 'O-1', test: true });
    expect(await buy.payItem('gold', 'lifetime', price())).toBe('ok');
    expect(checkout.mock.calls[0]![0]).toMatchObject({ title: 'Lifetime Gold', customId: 'gold:lifetime', price: 9.99 });
    expect(ent.paidAll()).toEqual([{ kind: 'gold', id: 'lifetime', exp: 0, order: 'O-1', src: 'local' }]);
    expect(addSpent).toHaveBeenCalledWith(9.99);
  });

  it('with a server, the server confirms the payment', async () => {
    const { ent, calls, checkout, buy } = setup({ status: 'ok', id: 'O-2', test: false },
      { '/paypal/confirm': { packs: [], gold: { plan: 'lifetime', exp: 0 } } });
    expect(await buy.payItem('gold', 'lifetime', price(SERVER))).toBe('ok');
    expect(calls[0]!.body).toMatchObject({ orderID: 'O-2', item: 'gold:lifetime' });
    expect(checkout.mock.calls[0]![0].serverCapture).toBe(true);
    expect(ent.paidAll()).toEqual([{ kind: 'gold', id: 'lifetime', exp: 0, src: 'server', renews: false, cancelled: false }]);
  });

  it('server refusals are reported', async () => {
    const { ent, addSpent, buy } = setup({ status: 'ok', id: 'O-3', test: false }, { '/paypal/confirm': { error: 'amount' } });
    expect(await buy.payItem('pack', 'xmas', price(SERVER), 'Christmas pack')).toBe('server-amount');
    expect(ent.paidAll()).toEqual([]);
    expect(addSpent).not.toHaveBeenCalled();
  });

  it('server unreachable unlocks nothing on this device (the server takes the payment)', async () => {
    const { ent, addSpent, buy } = setup({ status: 'ok', id: 'O-4', test: false });
    expect(await buy.payItem('pack', 'xmas', price(SERVER))).toBe('noserver');
    expect(ent.paidAll()).toEqual([]);
    expect(addSpent).not.toHaveBeenCalled();
  });

  it('without a server the browser takes the payment', async () => {
    const { checkout, buy } = setup({ status: 'ok', id: 'O-8', test: true });
    await buy.payItem('gold', 'lifetime', price());
    expect(checkout.mock.calls[0]![0].serverCapture).toBe(false);
  });

  it('donations through the server are confirmed before saying thanks', async () => {
    const { ent, calls, buy } = setup({ status: 'ok', id: 'O-9', test: false }, { '/paypal/confirm': { error: 'notpaid' } });
    expect(await buy.payItem('donate', 'donation', price(SERVER))).toBe('server-notpaid');
    expect(calls[0]!.body).toMatchObject({ orderID: 'O-9', item: 'donate:donation' });
    expect(ent.paidAll()).toEqual([]);
  });

  it('donations unlock nothing', async () => {
    const { ent, checkout, buy } = setup({ status: 'ok', id: 'O-5', test: false });
    expect(await buy.payItem('donate', 'donation', price())).toBe('ok');
    expect(checkout.mock.calls[0]![0].title).toBe('Donation to support Build That Wall');
    expect(ent.paidAll()).toEqual([]);
  });

  it('subscriptions without a plan id become one-off payments', async () => {
    const { checkout, buy } = setup({ status: 'ok', id: 'O-6', test: true });
    await buy.paySub('year', '', price());
    expect(checkout.mock.calls[0]![0]).toMatchObject({ title: '1 year of Gold', customId: 'gold:year' });
    expect(checkout.mock.calls[0]![0].planId).toBeUndefined();
  });

  it('subscriptions with a plan id renew', async () => {
    const { ent, checkout, buy } = setup({ status: 'ok', id: 'I-7', sub: true, test: true });
    expect(await buy.paySub('month', 'P-1', price())).toBe('ok');
    expect(checkout.mock.calls[0]![0]).toMatchObject({ planId: 'P-1', customId: 'gold:month' });
    expect(ent.paidAll()[0]).toMatchObject({ id: 'month', sub: 'I-7', renews: true, src: 'local' });
    expect(ent.goldRenews()).toBe(true);
  });

  it('ending a plan without a server marks it cancelled and opens PayPal', async () => {
    const { ent, openWindow, buy } = setup({ status: 'cancel' });
    ent.addPaid({ kind: 'gold', id: 'month', exp: Date.now() / 1000 + 100, renews: true, src: 'local' });
    expect(await buy.endPayment('')).toBe('paypal');
    expect(ent.goldRenews()).toBe(false);
    expect(openWindow).toHaveBeenCalledWith('https://www.paypal.com/myaccount/autopay/');
  });

  it('ending a plan through the server', async () => {
    const { buy } = setup({ status: 'cancel' }, { '/paypal/cancel': { error: 'nosub' } });
    expect(await buy.endPayment(SERVER)).toBe('nosub');
  });
});
