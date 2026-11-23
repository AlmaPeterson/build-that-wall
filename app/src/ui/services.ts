// The app's services (src/services), created once and shared by every screen.
// Guest play: everything works signed out. Signing in (Google) is only needed for Gold, purchases,
// saves that follow you to other devices, and putting your scores on the world leaderboard.
import { onItch, signInElsewhere } from '../services/account/link';
import { createBotMemory } from '../game/bots';
import type { BotMemory, GameEvent, GameState } from '../game';
import { addLine, lineFor, type GameMode } from '../services/stats/stats';
import { saleOn, salePrice } from '../services/notices/sales';
import { AccountService, GoogleSignIn, OtherSignIn, ServerApi, githubReturn, withoutGithubQuery, getUser, isSignedIn, markSignInExpired, maskedEmail, myName, signInExpired, verifiedUser, type FetchLike } from '../services/account';
import { DEFAULT_SETTINGS, loadSettings, type GameSettings as Config } from '../services/config';
import { Entitlements, GoldService, TrialWatcher } from '../services/gold';
import { Leaderboard, mqttWorldBoard } from '../services/leaderboard';
import { connectMqtt, type Connect } from '../services/online';
import { PAYMENTS_OFF_REASON, PayPalCheckout, Purchases, type BuyResult, type Checkout, type PriceInfo } from '../services/payments';
import { SaveStore, browserStorage, type KeyValueStorage } from '../services/storage';
import { controller as currentGame, gameOptions } from './app-state';
import type { GameController } from './controller';
import { OnlineClientController } from './online/client';
import { HostController } from './online/host';
import { createStore, type Store } from './store';

/** What the screens show about the player. Recomputed by refresh(). */
export interface PlayerInfo {
  signedIn: boolean;
  /** Signed in with a token the game server can check (needed for server saves and purchases). */
  verified: boolean;
  /** Known on this device, but the sign-in ran out: the game server refuses it until they sign in again. */
  expired: boolean;
  name: string;
  maskedEmail: string;
  gold: boolean;
  goldInfo: string;          // "Gold until 2026-12-01 (30 days left)", "" = none
  renews: boolean;
  owner: boolean;
}

export type GoldItem = 'month' | 'year';

export interface ServiceDeps {
  storage: KeyValueStorage | null;
  fetch: FetchLike & typeof fetch;
  connect: Connect;
  checkout?: Checkout;
  openWindow?: (url: string) => void;
  /** Shows a short message (the trial countdown, feedback results). */
  toast?: (text: string, ok: boolean) => void;
  location?: { search: string; href: string };
  /** Why payments are turned off ('' = on). Default PAYMENTS_OFF_REASON. */
  paymentsOff?: string;
}

export function createServices(deps: ServiceDeps) {
  const store = new SaveStore(deps.storage);
  const config: Store<Config> = createStore<Config>({ ...DEFAULT_SETTINGS });
  const api = new ServerApi(deps.fetch, () => verifiedUser(store)?.token ?? '', token => { if (markSignInExpired(store, token)) refresh(); });
  const ent = new Entitlements(store);
  const gold = new GoldService(store, ent, api);
  const account = new AccountService(store, ent, api);
  const google = new GoogleSignIn(store);
  const others = new OtherSignIn(store, (path, body) => api.call(config.get().serverUrl, path, body));
  const leaderboard = new Leaderboard(store, api, mqttWorldBoard(deps.connect));
  const checkout = deps.checkout ?? new PayPalCheckout().checkout;
  const purchases = new Purchases(store, ent, api, checkout, n => leaderboard.addSpent(n), deps.openWindow);
  /** Bot memory, saved like the old game's ("btw:aimem"). */
  const botMemory: BotMemory = createBotMemory({ get: k => store.get(k) || null, set: (k, v) => store.set(k, v) });
  const toast = deps.toast ?? (() => {});

  const info = (): PlayerInfo => ({
    signedIn: isSignedIn(store),
    verified: !!verifiedUser(store),
    expired: signInExpired(store),
    name: myName(store),
    maskedEmail: maskedEmail(store),
    gold: ent.goldActive(),
    goldInfo: ent.goldInfo(),
    renews: ent.goldRenews(),
    owner: ent.isOwner,
  });
  const player: Store<PlayerInfo> = createStore(info());
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    player.set(info());
    // Screens that are open when the sign-in runs out find out then, not at the next refresh
    clearTimeout(expiryTimer);
    const left = (verifiedUser(store)?.exp ?? 0) * 1000 - Date.now();
    if (left > 0 && left < 2 ** 31) expiryTimer = setTimeout(refresh, left + 1000);
  };
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
      // Back from GitHub's sign-in page (pop-ups were blocked): finish signing in
      const gh = githubReturn(deps.location?.search ?? '');
      if (gh && gh !== 'popup' && deps.location) {
        try { history.replaceState(null, '', withoutGithubQuery(deps.location.href)); } catch { /* not a browser */ }
        const r = await others.githubReturned(gh.code, gh.state);
        if ('name' in r) toast('Signed in as ' + r.name, false);
      }
      await gold.check(deps.location?.search ?? '');
      if (verifiedUser(store) && !signInExpired(store)) {
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
    const renewing = signInExpired(store) ? getUser(store)?.sub : undefined;
    const c = config.get();
    // Apple, GitHub and passwords are checked by the game server, so they need one
    const viaServer = /^https:/.test(c.serverUrl);
    // On itch.io Google, Apple and GitHub won't sign in on its shared web address: Google goes through our website
    const itch = onItch();
    const name = await google.signIn(itch ? '' : c.googleClientId, viaServer ? {
      apple: c.appleClientId && !itch ? () => others.apple(c.appleClientId) : undefined,
      github: c.githubClientId && !itch ? () => others.github(c.githubClientId) : undefined,
      password: (mode, user, pass) => others.password(mode, user, pass),
      elsewhere: itch && c.googleClientId ? (stillOpen, show) => signInElsewhere({
        call: (path, body) => api.call(c.serverUrl, path, body), accept: r => others.accept(r), stillOpen, show,
      }) : undefined,
    } : {});
    if (name && name !== 'nosetup') {
      // Same player back: what they did while signed out of the server is newer than its copy, which /load brings down
      if (renewing && renewing === getUser(store)?.sub) await account.save(server());
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

  /** A holiday sale's PayPal plan for Gold, if one is on today and the owner set up its plan. */
  function salePlan(item: GoldItem, now = new Date()): string {
    const c = config.get();
    return saleOn(now) ? (item === 'year' ? c.paypalPlanYearSale : c.paypalPlanMonthSale) : '';
  }

  function price(item: GoldItem | 'donate', amount?: number): PriceInfo {
    const c = config.get();
    let p = item === 'year' ? c.goldPriceYear : item === 'month' ? c.goldPriceMonth : (amount ?? 5);
    if (item !== 'donate' && salePlan(item)) p = salePrice(p, c.salePercent);
    return { price: p, currency: c.currency, clientId: c.paypalClientId, server: c.serverUrl };
  }

  /** Why payments are turned off right now ('' = they're on). */
  const paymentsOff = deps.paymentsOff ?? PAYMENTS_OFF_REASON;

  /** Buy Gold. Month/year renew when the owner set up a PayPal plan for them. */
  async function buyGold(item: GoldItem): Promise<BuyResult> {
    if (paymentsOff) return 'paused';
    if (signInExpired(store)) return 'server-login';         // before PayPal: the server couldn't record the payment
    const c = config.get();
    const r = await purchases.paySub(item, salePlan(item) || (item === 'year' ? c.paypalPlanYear : c.paypalPlanMonth), price(item));
    refresh();
    return r;
  }

  async function donate(amount: number): Promise<BuyResult> {
    if (paymentsOff) return 'paused';
    if (signInExpired(store)) return 'server-login';
    const r = await purchases.payItem('donate', 'donation', price('donate', amount));
    refresh();
    return r;
  }

  /**
   * After a game: this device's leaderboard and stats, the game server's score, and (signed in only)
   * the world leaderboard. `seats`: the human seats played on this device.
   */
  function recordGame(state: Readonly<GameState>, seats: number[], events: readonly GameEvent[] = [], mode?: GameMode): void {
    const over = state.over;
    if (!over) return;
    const me = myName(store);
    const names: string[] = [];
    for (const i of seats) {
      const seat = state.seats[i];
      if (!seat || seat.bot) continue;
      const won = over.winners.includes(i), miles = over.miles[i] ?? 0, walls = seat.walls.length;
      leaderboard.recordLocal(seat.name, won, miles, walls, !!seat.gold);
      names.push(seat.name);
      if (seat.name === me || seats.length === 1) {
        store.statAdd('games', 1);
        if (won) store.statAdd('wins', 1);
        store.set('stat_best', Math.max(+store.get('stat_best') || 0, miles));
        store.statAdd('walls', walls);
        // Detailed stats (Gold members see them): one line per game
        const line = lineFor(state, i, mode ?? (seats.length > 1 ? 'pass' : 'bots'), events);
        if (line) addLine(store, line);
        account.postScore(server(), { miles, won, walls, name: seat.name });
      }
    }
    if (getUser(store) && names.length) leaderboard.submitWorld(names);
    account.save(server());
  }

  /** Record every game shown on this device once it's over. */
  function watchGames(controllerStore: Store<GameController | null>, localSeats: (c: GameController) => number[], modeOf?: (c: GameController) => GameMode): () => void {
    let unsubGame: (() => void) | null = null;
    const watch = (c: GameController | null) => {
      unsubGame?.(); unsubGame = null;
      gameRunning = () => false;
      if (!c || c.replay) return;              // a replay of a game that was already counted
      let recorded = false;
      gameRunning = () => !!c.snapshot.get().view && !c.snapshot.get().view!.over;
      unsubGame = c.snapshot.subscribe(snap => {
        if (recorded || !snap.view?.over) return;
        recorded = true;
        recordGame(c.state ?? snap.view, localSeats(c), c.allEvents, modeOf?.(c));
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
    init, refresh, signIn, signOut, buyGold, donate, paymentsOff, recordGame, watchGames, server, price, salePlan,
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
// Bots on this device remember how each human plays (saved between visits)
gameOptions.memory = services.botMemory;


/** How a game is being played, for the stats. */
export function modeOf(c: GameController): GameMode {
  if (c instanceof HostController || c instanceof OnlineClientController) return 'online';
  const seats = c.state?.seats ?? [];
  const people = seats.filter(s => !s.bot).length;
  return people === 0 ? 'watch' : people > 1 ? 'pass' : 'bots';
}

/** The human seats played on this device: online, this device's player and their guests; Pass'n'Play, every human. */
export function localSeats(c: GameController): number[] {
  if (c instanceof HostController) return c.hostSeats;
  if (c instanceof OnlineClientController) return c.seats;
  return (c.state?.seats ?? []).flatMap((s, i) => (s.bot ? [] : [i]));
}

if (typeof window !== 'undefined') {
  void services.init();
  services.watchGames(currentGame, localSeats, modeOf);
}
