import { DEVICE_KEY_RE, PREFIX, stashKey } from './keys';

// The parts of localStorage we use, so tests can pass a fake
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// localStorage, or null when the browser blocks it (private mode, no DOM)
export function browserStorage(): KeyValueStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Saves for this browser only. Every key is stored as "btw:<key>".
export class SaveStore {
  private restoring = false;

  constructor(private readonly ls: KeyValueStorage | null) {}

  get(key: string): string {
    return this.ls ? (this.ls.getItem(PREFIX + key) || '') : '';
  }

  set(key: string, value: unknown): void {
    if (this.ls) try { this.ls.setItem(PREFIX + key, String(value)); } catch { /* storage full or blocked */ }
    // Signing in with the Google pop-up: bring back that account's data
    if (key === 'gemail' && String(value).trim() && !this.restoring) this.unstash('e:' + String(value).trim().toLowerCase());
  }

  remove(key: string): void {
    this.ls?.removeItem(PREFIX + key);
  }

  getJson<T>(key: string, fallback: T): T {
    try { return (JSON.parse(this.get(key) || 'null') as T) ?? fallback; } catch { return fallback; }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  // ---- settings: one JSON object of strings under "prefs"
  prefGet(name: string): string {
    const v = this.getJson<Record<string, string>>('prefs', {})[name];
    return v === undefined ? '' : v;
  }

  prefSet(name: string, value: unknown): void {
    const o = this.getJson<Record<string, string>>('prefs', {});
    o[name] = String(value);
    this.setJson('prefs', o);
  }

  // Lifetime stats like "stat_games"
  statAdd(name: string, n: number): void {
    const cur = +this.get('stat_' + name) || 0;
    this.set('stat_' + name, cur + (+n || 0));
  }

  // ---- Saved data belongs to an account: signing out keeps it safe on this device, signing back in brings it back
  static isDeviceKey(fullKey: string): boolean {
    return DEVICE_KEY_RE.test(fullKey);
  }

  stash(accountId: string): void {
    const ls = this.ls; if (!ls || !accountId) return;
    const o: Record<string, string | null> = {};
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX) && !SaveStore.isDeviceKey(k)) o[k.slice(PREFIX.length)] = ls.getItem(k);
    }
    try { ls.setItem(stashKey(accountId), JSON.stringify(o)); } catch { /* storage full */ }
  }

  // Only fills in keys that are empty now, so nothing newer is overwritten
  unstash(accountId: string): void {
    const ls = this.ls; if (!ls || !accountId) return;
    let o: Record<string, string> = {};
    try { o = JSON.parse(ls.getItem(stashKey(accountId)) || '{}'); } catch { /* broken stash */ }
    this.restoring = true;
    for (const k in o) if (!ls.getItem(PREFIX + k)) this.set(k, o[k]);
    this.restoring = false;
  }

  removeStash(accountId: string): void {
    if (accountId) this.ls?.removeItem(stashKey(accountId));
  }

  // ---- backups the player can copy and paste: every saved thing except the Google sign-in token
  exportBackup(): string | null {
    const ls = this.ls; if (!ls) return null;
    const o: Record<string, string | null> = {};
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX) && k !== PREFIX + 'user') o[k] = ls.getItem(k);
    }
    return 'BTWSAVE1.' + utf8ToBase64(JSON.stringify(o));
  }

  importBackup(code: string): 'ok' | 'bad' {
    try {
      const c = String(code || '').trim(); if (!c.startsWith('BTWSAVE1.')) return 'bad';
      const o = JSON.parse(base64ToUtf8(c.slice(9))) as Record<string, string>;
      const ls = this.ls; if (!ls) return 'bad';
      let n = 0;
      for (const k in o) if (k.startsWith(PREFIX) && k !== PREFIX + 'user') { ls.setItem(k, String(o[k])); n++; }
      return n ? 'ok' : 'bad';
    } catch { return 'bad'; }
  }

  // Forget this device's saves. A Google sign-in (unless expired), the leaderboard, used trials
  // and stashed accounts stay.
  clearLocal(signInExpired: boolean): void {
    const ls = this.ls; if (!ls) return;
    const keep = ['btw:user', 'btw:lb', 'btw:aimem', 'btw:trials'];
    if (signInExpired) keep.splice(0, 1);
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX) && !keep.includes(k) && !k.startsWith(PREFIX + 'acct:')) ls.removeItem(k);
    }
  }
}

// Same encoding as the old btoa(unescape(encodeURIComponent(s))), so old backups still import
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// A Map-backed KeyValueStorage for tests and for browsers without localStorage
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
