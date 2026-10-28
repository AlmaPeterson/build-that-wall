import type { SaveStore } from '../storage';

// Saved under "btw:user" after a Google sign-in
export interface GoogleUser {
  name: string;
  email?: string;
  sub?: string;
  token?: string;     // the Google ID token the game server checks
  exp?: number;       // token expiry, seconds since 1970
}

export function getUser(store: SaveStore): GoogleUser | null {
  try { return JSON.parse(store.get('user') || 'null'); } catch { return null; }
}

export function setUser(store: SaveStore, user: GoogleUser | null): void {
  store.set('user', user ? JSON.stringify(user) : '');
}

// Signed in with a token the server can check
export function verifiedUser(store: SaveStore): GoogleUser | null {
  const u = getUser(store);
  return u && u.token ? u : null;
}

// Signed in either way: Google token, or the older Google pop-up that only gives a name
export function isSignedIn(store: SaveStore): boolean {
  return !!verifiedUser(store) || !!store.get('gname');
}

export function userEmail(store: SaveStore): string {
  return String(getUser(store)?.email || store.get('gemail') || '');
}

// Which stash holds this player's data: "g:<sub>" for Google sign-in, "e:<email>" for the pop-up
export function accountId(store: SaveStore): string {
  const u = getUser(store); if (u && u.sub) return 'g:' + u.sub;
  const em = String(store.get('gemail') || '').trim().toLowerCase();
  return em ? 'e:' + em : '';
}

// "alex...@gmail.com"
export function maskedEmail(store: SaveStore): string {
  const m = userEmail(store); const at = m.indexOf('@');
  return at > 0 ? m.slice(0, Math.min(4, at)) + '...' + m.slice(at) : '';
}

// The name to show for this player
export function myName(store: SaveStore): string {
  return store.get('name') || getUser(store)?.name || store.get('gname') || 'Player';
}
