import { b64urlDecode } from '../gold/codes';
import type { SaveStore } from '../storage';
import { loadScript, type ScriptLoader } from './script-loader';
import { SIGN_IN_ERRORS, type SignInResult } from './providers';
import { accountId, setUser } from './user';

// ---- Google sign-in (Google Identity Services)

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, o: Record<string, string>): void;
  disableAutoSelect(): void;
}
/** The other ways to sign in that the box offers. */
export interface SignInChoices {
  apple?: () => Promise<SignInResult>;
  github?: () => Promise<SignInResult>;
  password?: (mode: 'login' | 'register', username: string, password: string) => Promise<SignInResult>;
}

type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleId } } };

const gis = () => (window as GoogleWindow).google?.accounts?.id;

// The parts of a Google ID token we read
export function decodeIdToken(credential: string): { given_name?: string; name?: string; email?: string; sub?: string; exp?: number } {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(credential.split('.')[1] || '')));
}

// At most 20 characters (counting emoji as one)
export const shortName = (s: unknown) => Array.from(String(s || 'Player').trim()).slice(0, 20).join('') || 'Player';

export class GoogleSignIn {
  constructor(private readonly store: SaveStore, private readonly load: ScriptLoader = loadScript) {}

  private async loadGis(): Promise<void> {
    if (gis()) return;
    await this.load('https://accounts.google.com/gsi/client');
  }

  // Shows the sign-in choices in a small box: Google's button, plus Apple, GitHub and a username and password
  // when the game has them. Resolves to the player's name, "" if cancelled, or "nosetup" when there's nothing
  // to sign in with (no client id, or Google can't be reached and there are no other ways).
  async signIn(clientId: string, others: SignInChoices = {}): Promise<string> {
    const cid = String(clientId || '').trim();
    const hasOthers = !!(others.apple || others.github || others.password);
    if ((!cid && !hasOthers) || typeof document === 'undefined') return 'nosetup';
    let id: GoogleId | undefined;
    if (cid) { try { await this.loadGis(); id = gis(); } catch { id = undefined; } }
    if (!id && !hasOthers) return 'nosetup';
    return new Promise(res => {
      const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = '') => {
        const e = document.createElement(tag); e.style.cssText = css; if (text) e.textContent = text; return e;
      };
      const wrap = el('div', 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;');
      const box = el('div', 'background:#fff;color:#222;padding:22px 26px;border-radius:12px;font:15px Arial;text-align:center;width:300px;max-width:calc(100vw - 32px);box-sizing:border-box;max-height:calc(100vh - 32px);overflow:auto;');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Sign in');
      box.append(el('div', 'font-weight:bold;color:#b3122a;font-size:18px;margin-bottom:12px', 'Sign in to Build That Wall'));
      const msg = el('div', 'color:#b3122a;font-size:13px;min-height:0;margin:6px 0');
      msg.setAttribute('role', 'alert');
      let done = false, busy = false;
      const finish = (v: string) => { if (done) return; done = true; wrap.remove(); res(v); };
      // Runs one way of signing in; shows why it didn't work, or closes the box with the name
      const attempt = async (run: () => Promise<SignInResult>) => {
        if (busy) return; busy = true; msg.textContent = '';
        try {
          const r = await run();
          if ('name' in r) finish(r.name); else msg.textContent = SIGN_IN_ERRORS[r.error] ?? SIGN_IN_ERRORS.login!;
        } catch { msg.textContent = SIGN_IN_ERRORS.login!; }
        busy = false;
      };
      const btnCss = 'display:block;width:100%;padding:9px 12px;margin:8px 0;border-radius:6px;font:bold 14px Arial;cursor:pointer;';
      const googleHolder = el('div', 'display:flex;justify-content:center;margin:8px 0');
      if (id) box.append(googleHolder);
      if (others.apple) {
        const b = el('button', btnCss + 'background:#000;color:#fff;border:1px solid #000', 'Sign in with Apple');
        b.onclick = () => attempt(others.apple!); box.append(b);
      }
      if (others.github) {
        const b = el('button', btnCss + 'background:#24292f;color:#fff;border:1px solid #24292f', 'Sign in with GitHub');
        b.onclick = () => attempt(others.github!); box.append(b);
      }
      if (others.password) {
        if (id || others.apple || others.github) box.append(el('div', 'color:#777;font-size:13px;margin:10px 0 4px', 'or use a username'));
        const form = el('form', 'display:flex;flex-direction:column;gap:6px;text-align:left');
        const input = (type: string, label: string, auto: AutoFill) => {
          const i = el('input', 'padding:8px;border:1px solid #aaa;border-radius:6px;font:15px Arial');
          i.type = type; i.placeholder = label; i.setAttribute('aria-label', label); i.autocomplete = auto; i.maxLength = type === 'password' ? 200 : 20;
          return i;
        };
        const user = input('text', 'Username', 'username'), pass = input('password', 'Password', 'current-password');
        const login = el('button', btnCss + 'margin:4px 0 0;background:#b3122a;color:#fff;border:1px solid #b3122a', 'Sign in');
        const register = el('button', btnCss + 'margin:0;background:#fff;color:#b3122a;border:1px solid #b3122a', 'Create account');
        login.type = 'submit'; register.type = 'button';
        form.onsubmit = e => { e.preventDefault(); void attempt(() => others.password!('login', user.value, pass.value)); };
        register.onclick = () => { pass.autocomplete = 'new-password'; void attempt(() => others.password!('register', user.value, pass.value)); };
        form.append(user, pass, login, register); box.append(form);
      }
      const cancel = el('button', 'margin-top:12px;padding:6px 16px;border:1px solid #aaa;background:#f4f4f4;color:#222;border-radius:6px;cursor:pointer', 'Cancel');
      cancel.onclick = () => finish('');
      box.append(msg, cancel); wrap.appendChild(box); document.body.appendChild(wrap);
      if (id) {
        id.initialize({ client_id: cid, callback: (resp) => {
          try { finish(this.acceptCredential(resp.credential)); } catch { finish(''); }
        } });
        id.renderButton(googleHolder, { theme: 'outline', size: 'large', text: 'signin_with' });
      }
    });
  }

  // Save the signed-in player and bring back their data from an earlier sign-in on this device
  acceptCredential(credential: string): string {
    const p = decodeIdToken(credential);
    const name = shortName(p.given_name || p.name);
    setUser(this.store, { name, email: p.email, sub: p.sub, token: credential, exp: p.exp });
    this.store.unstash('g:' + p.sub);
    return name;
  }

  // Their data is kept on this device for the next sign-in
  // NOTE: the old comment said "then cleared from view", but only the sign-in is removed;
  // the saves stay in place until clearLocal() is called.
  signOut(): void {
    this.store.stash(accountId(this.store));
    setUser(this.store, null);
    // The old game's pop-up sign-in (it was on the same site) left these behind; clear them too
    this.store.remove('gname');
    this.store.remove('gemail');
    try { gis()?.disableAutoSelect(); } catch { /* GIS not loaded */ }
  }
}
