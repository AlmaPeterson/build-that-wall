// The To-fix list (Account & Store > Feedback): every suggestion players sent, one line each, repeats counted.
// Everyone can read it (public suggestions only, without device details or the ones trashed). Only the owner
// can tick one done or trash it: the server checks OWNER_EMAIL on every change, whatever this page shows.
import { isSignedIn } from '../services/account';
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

export const fixes = createStore<{ items: Fix[]; loading: boolean; error: string; owner: boolean }>({ items: [], loading: false, error: '', owner: false });

export const fixKey = (f: Pick<Fix, 'list' | 'id'>) => f.list + ':' + f.id;

/** Most asked first, then the newest. */
export function sortFixes(items: Fix[]): Fix[] {
  return [...items].sort((a, b) => b.asked - a.asked || b.last - a.last);
}

/** The owner gets the whole list (and can change it); everyone else the public one. */
export async function loadFixes(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  const server = services.server();
  if (!server) { fixes.set({ items: [], loading: false, error: 'The game server is not set up.', owner: false }); return; }
  fixes.set({ ...fixes.get(), loading: true, error: '' });
  if (isSignedIn(services.store)) {
    const r = await services.api.call<{ items?: Fix[] }>(server, '/admin/fixes', {});
    if (r && !isError(r) && Array.isArray(r.items)) { fixes.set({ items: r.items, loading: false, error: '', owner: true }); return; }
  }
  try {
    const res = await fetchFn(server + (server.includes('?') ? '&' : '?') + 'path=fixes');
    const j = (await res.json()) as { items?: Fix[] };
    if (!Array.isArray(j.items)) throw new Error('no list');
    fixes.set({ items: j.items, loading: false, error: '', owner: false });
  } catch {
    fixes.set({ items: [], loading: false, error: "Couldn't load the list. Check your internet and try again.", owner: false });
  }
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
