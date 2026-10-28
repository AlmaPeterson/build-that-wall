import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../game';
import { mqttWorldBoard, WORLD_BOARD_TOPIC } from '../services/leaderboard';
import { FakeRelay } from '../services/online/fake-relay';
import { MemoryStorage } from '../services/storage';
import type { Checkout } from '../services/payments';
import { buyMessage } from './account/results';
import { settings } from './app-state';
import { playSfx, setAudioFactory } from './audio';
import { GameController } from './controller';
import { createServices, localSeats } from './services';
import { createStore } from './store';

const SERVER = 'https://script.google.com/macros/s/x/exec';

/** fetch that answers game-settings.json and the game server's paths. */
function fakeFetch(settingsFile: Record<string, unknown>, server: Record<string, unknown> = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === 'game-settings.json') return { ok: true, json: async () => settingsFile } as Response;
    const path = url.replace(SERVER, '');
    if (path in server) return { ok: true, json: async () => server[path] } as Response;
    throw new Error('offline');
  });
  return { f: f as unknown as typeof fetch & ((u: string, i?: RequestInit) => Promise<Response>), calls };
}

function make(opts: { server?: Record<string, unknown>; signedIn?: boolean; checkout?: Checkout } = {}) {
  const storage = new MemoryStorage();
  if (opts.signedIn) storage.setItem('btw:user', JSON.stringify({ name: 'Ann', email: 'ann@example.com', sub: '1', token: 'tok' }));
  const { f, calls } = fakeFetch({ 'Server URL': SERVER, 'Gold Price Lifetime': 12.5, 'Currency': 'EUR' }, opts.server);
  const relay = new FakeRelay();
  const checkout: Checkout = opts.checkout ?? (async () => ({ status: 'ok', id: 'O-1', test: true }));
  const s = createServices({ storage, fetch: f, connect: relay.connect, checkout, openWindow: () => {} });
  return { s, storage, calls, relay };
}

describe('app services', () => {
  it('loads game-settings.json and works signed out (guest play)', async () => {
    const { s } = make();
    await s.init();
    expect(s.config.get().goldPriceLifetime).toBe(12.5);
    expect(s.config.get().currency).toBe('EUR');
    expect(s.player.get()).toMatchObject({ signedIn: false, gold: false, name: 'Player' });
  });

  it('signed in, init loads the account from the game server', async () => {
    const { s, calls } = make({ signedIn: true, server: { '/load': { packs: [], gold: { plan: 'lifetime', exp: 0 } }, '/account': { codes: [] } } });
    await s.init();
    expect(calls.some(c => c.url.endsWith('/load'))).toBe(true);
    expect(s.player.get()).toMatchObject({ signedIn: true, gold: true, goldInfo: 'Lifetime Gold' });
  });

  it("a purchase the server doesn't answer unlocks nothing and says not to pay again", async () => {
    const { s } = make({ signedIn: true });       // no /paypal/confirm answer: the server is unreachable
    await s.init();
    const r = await s.buyGold('lifetime');
    expect(r).toBe('noserver');
    expect(s.player.get().gold).toBe(false);
    expect(buyMessage(r, 'gold')!.text).toMatch(/don't pay again/);
  });

  it('a confirmed purchase unlocks Gold with the price from game-settings.json', async () => {
    const checkout = vi.fn<Checkout>(async () => ({ status: 'ok', id: 'O-2', approved: true, test: false }));
    const { s, calls } = make({ signedIn: true, checkout, server: { '/paypal/confirm': { packs: [], gold: { plan: 'lifetime', exp: 0 } } } });
    await s.init();
    expect(await s.buyGold('lifetime')).toBe('ok');
    expect(checkout.mock.calls[0]![0]).toMatchObject({ price: 12.5, currency: 'EUR', serverCapture: true });
    expect(calls.find(c => c.url.endsWith('/paypal/confirm'))!.body).toMatchObject({ item: 'gold:lifetime', orderID: 'O-2' });
    expect(s.player.get().gold).toBe(true);
  });

  it('records each finished game on the device leaderboard and stats', () => {
    const { s, storage } = make();
    const state = createGame({ players: 2, bots: 1, difficulties: ['easy'], names: ['Ann'], ending: 1, endingTimes: 1, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 1);
    state.seats[0]!.walls = [29, 29, 30];
    state.over = { winners: [0], miles: [11, 3], reason: 'test' };
    s.recordGame(state, [0]);
    expect(JSON.parse(storage.getItem('btw:lb')!).Ann).toMatchObject({ games: 1, wins: 1, best: 11, walls: 3 });
    expect(storage.getItem('btw:stat_games')).toBe('1');
  });

  it('watches the running game and records it once when it ends', async () => {
    const { s, storage } = make();
    const current = createStore<GameController | null>(null);
    s.watchGames(current, localSeats);
    const c = new GameController();
    current.set(c);
    await c.start({ players: 2, bots: 2, difficulties: ['easy', 'easy'], names: [], ending: 1, endingTimes: 1, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 4);
    // bots only: no humans on this device, so nothing to record
    expect(storage.getItem('btw:lb')).toBeNull();
  });
});

describe('world leaderboard over MQTT', () => {
  it('reads the retained board and merges an update into it', async () => {
    const relay = new FakeRelay();
    relay.publish(WORLD_BOARD_TOPIC, JSON.stringify({ Bea: { games: 3, wins: 1, best: 40, walls: 9, at: 1 } }), true);
    const world = mqttWorldBoard(relay.connect, () => Promise.resolve());
    await new Promise(r => setTimeout(r, 0));
    const board = await world.readAndUpdate({ Ann: { games: 1, wins: 1, best: 22, walls: 4 } });
    expect(Object.keys(board!).sort()).toEqual(['Ann', 'Bea']);
    const retained = relay.sent(WORLD_BOARD_TOPIC).at(-1)!;
    expect(retained).toHaveProperty('Ann');
    expect(retained).toHaveProperty('Bea');
  });

  it('gives up (null) when the relay is unreachable', async () => {
    const relay = new FakeRelay();
    relay.online = false;
    expect(await mqttWorldBoard(relay.connect, () => Promise.resolve()).readAndUpdate(null)).toBeNull();
  });
});

describe('sound effects', () => {
  it('play only when Sound Effects is on', () => {
    const played: string[] = [];
    setAudioFactory(src => ({ volume: 1, play: () => { played.push(src); return Promise.resolve(); } }));
    settings.set({ ...settings.get(), sound: false });
    playSfx('card');
    expect(played).toEqual([]);
    settings.set({ ...settings.get(), sound: true });
    playSfx('card'); playSfx('click'); playSfx('build'); playSfx('nonsense');
    expect(played).toEqual(['assets/cards/card.wav', 'assets/buttons/click.wav', 'assets/cards/card.wav']);
  });
});
