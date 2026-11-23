// Join links: ".../build-that-wall/?join=ABCDE". The host copies or shares it from the waiting room; opening it
// goes straight to the Online screen and joins that room.
import { createStore } from '../store';

/** A room code from a join link, waiting for the Online screen to join it. */
export const pendingJoin = createStore<string | null>(null);

/** The link that joins this room, on the page the game is on now. */
export function joinLink(code: string, loc: Pick<Location, 'origin' | 'pathname'> = location): string {
  return loc.origin + loc.pathname + '?join=' + encodeURIComponent(code);
}

/** The room code in a page address's "?join=", or null. Only letters and numbers, 4 to 8 of them. */
export function joinCodeIn(search: string): string | null {
  const code = (new URLSearchParams(search).get('join') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
}

/**
 * Opened from a join link: remember the code for the Online screen, and take "?join=" out of the address
 * so a reload later doesn't join again. Returns the code, or null.
 */
export function takeJoinLink(): string | null {
  if (typeof location === 'undefined') return null;
  const code = joinCodeIn(location.search);
  if (!code) return null;
  const url = new URL(location.href);
  url.searchParams.delete('join');
  try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* fine */ }
  pendingJoin.set(code);
  return code;
}

/** Copy the link, or on a phone open the share sheet (Messages, WhatsApp...). Says what happened. */
export async function shareJoinLink(code: string, share: boolean, link?: string): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  const url = link || joinLink(code);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (share && nav?.share) {
    try { await nav.share({ title: 'Build That Wall', text: 'Join my Build That Wall game! Room code ' + code, url }); return 'shared'; }
    catch (e) { if ((e as Error)?.name === 'AbortError') return 'cancelled'; }
  }
  try { await nav!.clipboard.writeText(url); return 'copied'; } catch { return 'failed'; }
}
