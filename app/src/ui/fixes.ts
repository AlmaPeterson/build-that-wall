// The owner's To-fix list: every suggestion players sent (one line each, repeats counted), from the game
// server's Suggestions and Private sheets. Ticking one marks it done; the trash marks it "won't do".
// Only the owner's account gets it: the server checks OWNER_EMAIL on every call, and the page has no link
// of its own, so typing an address can't open it.
import { isError } from '../services/account/api';
import { services } from './services';
import { createStore } from './store';

export type FixStatus = '' | 'done' | 'skip';
export interface Fix {
  id: number;
  /** Which sheet: "private" is cheats, exploits and strategy tips */
  list: 'public' | 'private';
  text: string;
  type: string;
  /** How many players asked for it */
  asked: number;
  first: number;
  last: number;
  device?: string;
  status: FixStatus;
}

export const fixes = createStore<{ items: Fix[]; loading: boolean; error: string }>({ items: [], loading: false, error: '' });

export const fixKey = (f: Pick<Fix, 'list' | 'id'>) => f.list + ':' + f.id;

/** Most asked first, then the newest. */
export function sortFixes(items: Fix[]): Fix[] {
  return [...items].sort((a, b) => b.asked - a.asked || b.last - a.last);
}

export async function loadFixes(): Promise<void> {
  const server = services.server();
  if (!server) { fixes.set({ items: [], loading: false, error: 'The game server is not set up.' }); return; }
  fixes.set({ ...fixes.get(), loading: true, error: '' });
  const r = await services.api.call<{ items?: Fix[] }>(server, '/admin/fixes', {});
  if (!r || isError(r) || !Array.isArray(r.items)) {
    fixes.set({ items: [], loading: false, error: r && isError(r) && r.error === 'owner' ? 'Only the owner can see this list.' : "Couldn't load the list. Check your internet and try again." });
    return;
  }
  fixes.set({ items: r.items, loading: false, error: '' });
}

/** Tick, trash or put back a suggestion. Shown at once; put back as it was if the server says no. */
export async function setFix(f: Fix, status: FixStatus): Promise<void> {
  const server = services.server();
  if (!server) return;
  const before = f.status;
  const change = (s: FixStatus) => fixes.set({ ...fixes.get(), items: fixes.get().items.map(x => (fixKey(x) === fixKey(f) ? { ...x, status: s } : x)) });
  change(status);
  const r = await services.api.call(server, '/admin/fix', { list: f.list, id: f.id, status });
  if (!r || isError(r)) {
    change(before);
    fixes.set({ ...fixes.get(), error: "Couldn't save that. Check your internet and try again." });
  }
}
