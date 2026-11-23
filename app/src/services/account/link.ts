// Google sign-in for the itch.io copy of the game. itch.io runs every game on one shared web address, so
// Google sign-in isn't allowed there (any other itch.io game could use it). Instead the itch.io copy opens the
// game's own website with "?link=<random id>"; the player signs in with Google there and presses Yes, and the
// game server hands the itch.io copy a sign-in for the same account (game-server.gs: link/approve, link-claim).
// Both pages show the same 4-letter code, so the player can see they belong together.
import type { AuthCall, AuthReply, SignInResult } from './providers';

/** The game's own website, where Google sign-in is allowed. */
export const SITE = 'https://almapeterson.github.io/build-that-wall/';

/** True when the game is running on itch.io. */
export const onItch = (host = typeof location !== 'undefined' ? location.hostname : '') => /(^|\.)itch\.(zone|io)$/i.test(host);

const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A new random link id (32 letters and numbers). */
export function newLinkId(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(random(32), b => abc[b % abc.length]).join('');
}

/** The 4-letter code both pages show for a link id. */
export function linkCode(id: string): string {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let code = '';
  for (let i = 0; i < 4; i++) { code += LETTERS[h % LETTERS.length]; h = Math.floor(h / LETTERS.length) || (h * 7 + 3); }
  return code;
}

/** The website address that approves a link. */
export const linkUrl = (id: string) => SITE + '?link=' + encodeURIComponent(id);

/** The link id in a page address's "?link=", or null. */
export function linkIdIn(search: string): string | null {
  const id = new URLSearchParams(search).get('link') ?? '';
  return /^[A-Za-z0-9_-]{20,64}$/.test(id) ? id : null;
}

export interface ElsewhereOptions {
  call: AuthCall;
  accept: (r: AuthReply) => string;
  /** False once the player closed the sign-in box: stop waiting. */
  stillOpen: () => boolean;
  /** Show the code and the link to open (in case the new tab didn't open). */
  show: (code: string, url: string) => void;
  open?: (url: string) => void;
  wait?: (ms: number) => Promise<void>;
  id?: string;
  /** How long to wait for the player, in ms (the server keeps a link 10 minutes). */
  timeout?: number;
}

/** Open the website to sign in with Google, then wait for the game server to hand over the sign-in. */
export async function signInElsewhere(o: ElsewhereOptions): Promise<SignInResult> {
  const id = o.id ?? newLinkId();
  const url = linkUrl(id);
  o.show(linkCode(id), url);
  (o.open ?? (u => { window.open(u, '_blank', 'noopener'); }))(url);
  const wait = o.wait ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const until = Date.now() + (o.timeout ?? 10 * 60 * 1000);
  while (o.stillOpen() && Date.now() < until) {
    await wait(2500);
    if (!o.stillOpen()) break;
    const r = await o.call('auth/link-claim', { link: id }) as (Partial<AuthReply> & { error?: string; waiting?: boolean }) | null;
    if (!r || r.waiting) continue;                         // offline for a moment, or not approved yet
    if (r.error) return { error: String(r.error) };
    if (r.token && r.id) return { name: o.accept(r as AuthReply) };
  }
  return { error: o.stillOpen() ? 'linktimeout' : 'cancelled' };
}
