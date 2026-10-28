import { b64urlDecode } from '../gold/codes';
import type { SaveStore } from '../storage';
import { loadScript, type ScriptLoader } from './script-loader';
import { accountId, setUser } from './user';

// ---- Google sign-in (Google Identity Services)

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, o: Record<string, string>): void;
  disableAutoSelect(): void;
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

  // Shows the Google button in a small box. Resolves to the player's name, "" if cancelled,
  // or "nosetup" when there's no client id or Google can't be reached.
  async signIn(clientId: string): Promise<string> {
    const cid = String(clientId || '').trim();
    if (!cid || typeof document === 'undefined') return 'nosetup';
    try { await this.loadGis(); } catch { return 'nosetup'; }
    const id = gis(); if (!id) return 'nosetup';
    return new Promise(res => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;padding:22px 26px;border-radius:12px;font:15px Arial;text-align:center;min-width:280px;';
      box.innerHTML = "<div style='font-weight:bold;color:#b3122a;font-size:18px;margin-bottom:12px'>Sign in to Build That Wall</div>";
      const btnHolder = document.createElement('div'); btnHolder.style.cssText = 'display:flex;justify-content:center;margin:8px 0 14px';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
      cancel.style.cssText = 'padding:6px 16px;border:1px solid #aaa;background:#f4f4f4;border-radius:6px;cursor:pointer';
      let done = false;
      const finish = (v: string) => { if (done) return; done = true; wrap.remove(); res(v); };
      cancel.onclick = () => finish('');
      box.append(btnHolder, cancel); wrap.appendChild(box); document.body.appendChild(wrap);
      id.initialize({ client_id: cid, callback: (resp) => {
        try { finish(this.acceptCredential(resp.credential)); } catch { finish(''); }
      } });
      id.renderButton(btnHolder, { theme: 'outline', size: 'large', text: 'signin_with' });
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
    // The older pop-up sign-in (the classic game, on the same site) counts as signed in too
    this.store.remove('gname');
    this.store.remove('gemail');
    try { gis()?.disableAutoSelect(); } catch { /* GIS not loaded */ }
  }
}
