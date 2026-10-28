// The app's services (src/services), created once and shared by every screen.
// Guest play: everything works signed out. Signing in (Google) is only needed for Gold, purchases,
// saves that follow you to other devices, and putting your scores on the world leaderboard.
import { createBotMemory } from '../game/bots';
import type { BotMemory, GameState } from '../game';
import { AccountService, GoogleSignIn, ServerApi, getUser, isSignedIn, maskedEmail, myName, verifiedUser, type FetchLike } from '../services/account';
import { DEFAULT_SETTINGS, loadSettings, type GameSettings as Config } from '../services/config';
import { Entitlements, GoldService, TrialWatcher } from '../services/gold';
import { Leaderboard, mqttWorldBoard } from '../services/leaderboard';
import { connectMqtt, type Connect } from '../services/online';
import { PayPalCheckout, Purchases, type BuyResult, type Checkout, type PriceInfo } from '../services/payments';
import { SaveStore, browserStorage, type KeyValueStorage } from '../services/storage';
import type { GameController } from './controller';
import { createStore, type Store } from './store';

/** What the screens show about the player. Recomputed by refresh(). */
export interface PlayerInfo {
  signedIn: boolean;
  /** Signed in with a token the game server can check (needed for server saves and purchases). */
  verified: boolean;
  name: string;
  maskedEmail: string;
  gold: boolean;
  goldInfo: string;          // "Gold until 2026-12-01 (30 days left)", "" = none
  renews: boolean;
  owner: boolean;
}

export type GoldItem = 'lifetime' | 'month' | 'year';

export interface ServiceDeps {
  storage: KeyValueStorage | null;
  fetch: FetchLike & typeof fetch;
  connect: Connect;
  checkout?: Checkout;
  openWindow?: (url: string) => void;
  /** Shows a short message (the trial countdown, feedback results). */
  toast?: (text: string, ok: boolean) => void;
  location?: { search: string; href: string };
}

export function createServices(deps: ServiceDeps) {
  const store = new SaveStore(deps.storage);
  const config: Store<Config> = createStore<Config>({ ...DEFAULT_SETTINGS });
  const api = new ServerApi(deps.fetch, () => verifiedUser(store)?.token ?? '');
  const ent = new Entitlements(store);
  const gold = new GoldService(store, ent, api);
  const account = new AccountService(store, ent, api);
  const google = new GoogleSignIn(store);
  const leaderboard = new Leaderboard(store, api, mqttWorldBoard(deps.connect));
  const checkout = deps.checkout ?? new PayPalCheckout().checkout;
  const purchases = new Purchases(store, ent, api, checkout, n => leaderboard.addSpent(n), deps.openWindow);
  /** Bot memory, saved like the old game's ("btw:aimem"). */
  const botMemory: BotMemory = createBotMemory({ get: k => store.get(k) || null, set: (k, v) => store.set(k, v) });
  const toast = deps.toast ?? (() => {});

  const info = (): PlayerInfo => ({
    signedIn: isSignedIn(store),
    verified: !!verifiedUser(store),
    name: myName(store),
    maskedEmail: maskedEmail(store),
    gold: ent.goldActive(),
    goldInfo: ent.goldInfo(),
    renews: ent.goldRenews(),
    owner: ent.isOwner,
  });
  const player: Store<PlayerInfo> = createStore(info());
  const refresh = () => player.set(info());
  const server = () => config.get().serverUrl;

  let started: Promise<void> | null = null;
  let gameRunning = (): boolean => false;
  const trial = new TrialWatcher(store, ent, {
    isGameRunning: () => gameRunning(),
    showCountdown: text => toast(text, true),
    showEnded: () => toast('Your Gold free trial has ended. Thanks for trying it!', false),
    onEnded: refresh,
  });

  /** Load game-settings.json, re-check Gold and sync the account. Safe to call many times. */
  function init(): Promise<void> {
    if (!started) started = (async () => {
      const r = await loadSettings(deps.fetch);
      config.set(r.settings);
      await gold.check(deps.location?.search ?? '');
      if (verifiedUser(store)) {
        await account.load(server());
        await gold.sync(server());
      }
      await account.ownerCheck();
      refresh();
      if (typeof window !== 'undefined') trial.start();
    })().catch(() => { refresh(); });
    return started;
  }

  async function signIn(): Promise<string> {
    const name = await google.signIn(config.get().googleClientId);
    if (name && name !== 'nosetup') {
      await account.load(server());
      await gold.sync(server());
      await account.ownerCheck();
    }
    refresh();
    return name;
  }

  function signOut(): void {
    account.save(server());
    google.signOut();
    ent.isOwner = false;
    void gold.check();
    refresh();
  }

  function price(item: GoldItem | 'donate', amount?: number): PriceInfo {
    const c = config.get();
    const p = item === 'lifetime' ? c.goldPriceLifetime : item === 'year' ? c.goldPriceYear : item === 'month' ? c.goldPriceMonth : (amount ?? 5);
    return { price: p, currency: c.currency, clientId: c.paypalClientId, server: c.serverUrl };
  }

  /** Buy Gold. Month/year renew when the owner set up a PayPal plan for them. */
  async function buyGold(item: GoldItem): Promise<BuyResult> {
    const c = config.get();
    const r = item === 'lifetime' ? await purchases.payItem('gold', 'lifetime', price(item))
      : await purchases.paySub(item, item === 'year' ? c.paypalPlanYear : c.paypalPlanMonth, price(item));
    refresh();
    return r;
  }

  async function donate(amount: number): Promise<BuyResult> {
    const r = await purchases.payItem('donate', 'donation', price('donate', amount));
    refresh();
    return r;
  }

  /**
   * After a game: this device's leaderboard and stats, the game server's score, and (signed in only)
   * the world leaderboard. `seats`: the human seats played on this device.
   */
  function recordGame(state: Readonly<GameState>, seats: number[]): void {
    const over = state.over;
    if (!over) return;
    const me = myName(store);
    const names: string[] = [];
    for (const i of seats) {
      const seat = state.seats[i];
      if (!seat || seat.bot) continue;
      const won = over.winners.includes(i), miles = over.miles[i] ?? 0, walls = seat.walls.length;
      leaderboard.recordLocal(seat.name, won, miles, walls);
      names.push(seat.name);
      if (seat.name === me || seats.length === 1) {
        store.statAdd('games', 1);
        if (won) store.statAdd('wins', 1);
        store.set('stat_best', Math.max(+store.get('stat_best') || 0, miles));
        store.statAdd('walls', walls);
        account.postScore(server(), { miles, won, walls, name: seat.name });
      }
    }
    if (getUser(store) && names.length) leaderboard.submitWorld(names);
    account.save(server());
  }

  /** Record every game shown on this device once it's over. */
  function watchGames(controllerStore: Store<GameController | null>, localSeats: (c: GameController) => number[]): () => void {
    let unsubGame: (() => void) | null = null;
    const watch = (c: GameController | null) => {
      unsubGame?.(); unsubGame = null;
      gameRunning = () => false;
      if (!c) return;
      let recorded = false;
      gameRunning = () => !!c.snapshot.get().view && !c.snapshot.get().view!.over;
      unsubGame = c.snapshot.subscribe(snap => {
        if (recorded || !snap.view?.over) return;
        recorded = true;
        recordGame(c.state ?? snap.view, localSeats(c));
        refresh();
      });
    };
    watch(controllerStore.get());
    const unsub = controllerStore.subscribe(watch);
    return () => { unsub(); unsubGame?.(); };
  }

  return {
    store, config, api, ent, gold, account, google, leaderboard, purchases, botMemory, player,
    connect: deps.connect, toast,
    init, refresh, signIn, signOut, buyGold, donate, recordGame, watchGames, server,
  };
}

export type AppServices = ReturnType<typeof createServices>;

/** A short message at the top of the page. */
export function domToast(text: string, ok: boolean): void {
  if (typeof document === 'undefined') return;
  const t = document.createElement('div');
  t.textContent = text;
  t.setAttribute('role', 'status');
  t.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99998;padding:12px 22px;border-radius:14px;' +
    'font:bold 17px Arial;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:92vw;text-align:center;' +
    (ok ? 'background:#c9a227;border:3px solid #7a5c0a;' : 'background:#d9342b;border:3px solid #5a1210;');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

export const services: AppServices = createServices({
  storage: browserStorage(),
  fetch: ((...a: Parameters<typeof fetch>) => fetch(...a)) as FetchLike & typeof fetch,
  connect: () => connectMqtt(),
  openWindow: url => { window.open(url, '_blank', 'noopener'); },
  toast: domToast,
  location: typeof location !== 'undefined' ? location : undefined,
});
