import type { SaveStore } from '../storage';
import { shortName } from './google';
import { loadScript, type ScriptLoader } from './script-loader';
import { setUser } from './user';

// ---- Sign in with Apple, GitHub, or a username and password. The game server checks them (auth/* in
// game-server.gs) and hands back its own sign-in token, good for 30 days.

/** What the game server sends back from auth/*. */
export interface AuthReply { token: string; id: string; name: string; email?: string; exp: number }

/** A name when it worked, or why it didn't. */
export type SignInResult = { name: string } | { error: string };

/** POSTs to the game server; null when there's no server or it can't be reached. */
export type AuthCall = (path: string, body: Record<string, unknown>) => Promise<unknown>;

/** What to tell the player for each error. */
export const SIGN_IN_ERRORS: Record<string, string> = {
  linktimeout: 'Signing in on our website took too long. Press Sign in with Google to try again.',
  needemail: "Your account needs an email now. Type it below and we'll send you a code.",
  email: 'Type your email address, like name@example.com.',
  emailused: 'That email already has an account. Sign in to it instead.',
  code: "That code isn't right. Check the email and try again.",
  codeexpired: 'That code has run out. Press "Email me a code" again.',
  toomany: 'Too many codes were sent to that email. Try again in an hour.',
  mailfail: "We couldn't send the email. Check the address and try again.",
  wrong: 'Wrong username or password.',
  locked: 'Too many tries. Wait 15 minutes and try again.',
  taken: 'That username is taken. Pick another one.',
  weak: 'Use at least 8 characters for the password.',
  username: 'Usernames are 3 to 20 letters, numbers, dots, dashes or underscores.',
  nosetup: "That sign-in isn't set up on the game server yet.",
  offline: "Couldn't reach the game server. Try again in a moment.",
  login: "That sign-in didn't work. Try again.",
  cancelled: '',
};

interface AppleId {
  auth: {
    init(o: Record<string, unknown>): void;
    signIn(): Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string } } }>;
  };
}
type AppleWindow = Window & { AppleID?: AppleId };

const GITHUB_STATE = 'btw-gh-state';
const session = () => { try { return window.sessionStorage; } catch { return null; } };

/** The page address GitHub and Apple send the player back to: this page, without ?query or #hash. */
export const returnUrl = (loc: { origin: string; pathname: string }) => loc.origin + loc.pathname;

export class OtherSignIn {
  constructor(private readonly store: SaveStore, private readonly call: AuthCall, private readonly load: ScriptLoader = loadScript) {}

  /** Save the signed-in player and bring back their data from an earlier sign-in on this device. */
  accept(r: AuthReply): string {
    const name = shortName(r.name);
    setUser(this.store, { name, email: r.email || undefined, sub: r.id, token: r.token, exp: r.exp });
    this.store.unstash('g:' + r.id);
    return name;
  }

  private async finish(path: string, body: Record<string, unknown>): Promise<SignInResult> {
    const r = await this.call(path, body) as Partial<AuthReply> & { error?: string } | null;
    if (!r) return { error: 'offline' };
    if (r.error) return { error: String(r.error) };
    if (!r.token || !r.id) return { error: 'login' };
    return { name: this.accept(r as AuthReply) };
  }

  /** Sign in, or make a new account (with the code emailed by sendCode), with a username and password. */
  password(mode: 'login' | 'register', username: string, password: string, code = ''): Promise<SignInResult> {
    return this.finish(mode === 'login' ? 'auth/password-login' : 'auth/password-register',
      mode === 'login' ? { username: username.trim(), password } : { username: username.trim(), password, code: code.trim() });
  }

  /** An old username account (made before emails were checked) adds an email: send the code... */
  async addEmailCode(username: string, password: string, email: string): Promise<{ sent: true } | { error: string }> {
    const r = await this.call('auth/login-email-code', { username: username.trim(), password, email: email.trim() }) as { sent?: boolean; error?: string } | null;
    if (!r) return { error: 'offline' };
    if (r.error) return { error: String(r.error) };
    return r.sent ? { sent: true } : { error: 'login' };
  }

  /** ...then sign in with it, saving the email to the account. */
  addEmailConfirm(username: string, password: string, code: string): Promise<SignInResult> {
    return this.finish('auth/login-email-confirm', { username: username.trim(), password, code: code.trim() });
  }

  /** A new account: email a 6-digit code to check the email is theirs. */
  async sendCode(username: string, password: string, email: string): Promise<{ sent: true } | { error: string }> {
    const r = await this.call('auth/register-code', { username: username.trim(), password, email: email.trim() }) as { sent?: boolean; error?: string } | null;
    if (!r) return { error: 'offline' };
    if (r.error) return { error: String(r.error) };
    return r.sent ? { sent: true } : { error: 'login' };
  }

  /** Apple's sign-in pop-up. Apple only gives the player's name the first time they sign in. */
  async apple(clientId: string): Promise<SignInResult> {
    try {
      if (!(window as AppleWindow).AppleID) await this.load('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const apple = (window as AppleWindow).AppleID!;
      apple.auth.init({ clientId, scope: 'name email', redirectURI: returnUrl(location), usePopup: true });
      const r = await apple.auth.signIn();
      const n = r.user?.name;
      return this.finish('auth/apple', { apple_token: r.authorization.id_token, name: [n?.firstName, n?.lastName].filter(Boolean).join(' ') });
    } catch {
      return { error: 'cancelled' };
    }
  }

  /** GitHub's sign-in page, in a pop-up. If pop-ups are blocked the whole page goes there and comes back (see githubReturn). */
  github(clientId: string): Promise<SignInResult> {
    const state = 'btwgh' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    session()?.setItem(GITHUB_STATE, state);
    const redirect = returnUrl(location);
    const url = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, scope: 'read:user user:email', state,
    }).toString();
    const popup = window.open(url, 'btw-github', 'width=520,height=680');
    if (!popup) { location.assign(url); return new Promise(() => {}); }
    return new Promise(res => {
      let done = false;
      const stop = (r: SignInResult) => { if (done) return; done = true; window.removeEventListener('message', onMessage); clearInterval(timer); res(r); };
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== location.origin || !e.data || e.data.btwGithub === undefined) return;
        if (e.data.state !== state) return stop({ error: 'login' });
        void this.finish('auth/github', { code: e.data.btwGithub, redirect_uri: redirect }).then(stop);
      };
      window.addEventListener('message', onMessage);
      // Closed without signing in
      const timer = setInterval(() => { if (popup.closed) setTimeout(() => stop({ error: 'cancelled' }), 500); }, 500);
    });
  }

  /** Finishes a GitHub sign-in that came back to this page (pop-ups were blocked). */
  async githubReturned(code: string, state: string): Promise<SignInResult> {
    const want = session()?.getItem(GITHUB_STATE);
    session()?.removeItem(GITHUB_STATE);
    if (!want || want !== state) return { error: 'login' };
    return this.finish('auth/github', { code, redirect_uri: returnUrl(location) });
  }
}

/**
 * GitHub sent the player back here with ?code=…&state=btwgh…. In the pop-up, hands the code to the game
 * that opened it and closes ("popup"). Otherwise returns the code for the game to finish signing in.
 */
export function githubReturn(search: string): 'popup' | { code: string; state: string } | null {
  const q = new URLSearchParams(search);
  const code = q.get('code'), state = q.get('state') || '';
  if (!code || !state.startsWith('btwgh')) return null;
  try {
    if (window.opener && window.opener !== window && window.name === 'btw-github') {
      window.opener.postMessage({ btwGithub: code, state }, location.origin);
      window.close();
      return 'popup';
    }
  } catch { /* the opener is another site */ }
  return { code, state };
}

/** The page address without GitHub's ?code and ?state, so a reload doesn't try them again. */
export function withoutGithubQuery(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('code'); u.searchParams.delete('state');
  return u.toString();
}
