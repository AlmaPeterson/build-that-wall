// Shared fakes for the services' tests (not used by the game)
import { MemoryStorage, SaveStore } from '../storage';
import { ServerApi, type FetchLike } from './api';

export function makeStore() {
  const ls = new MemoryStorage();
  return { ls, store: new SaveStore(ls) };
}

export const SERVER = 'https://script.google.com/macros/s/x/exec';

// A fake server: path → reply, or a function of the request body. Missing path = offline.
export function fakeApi(replies: Record<string, unknown>, token = 'tok') {
  const calls: { url: string; init?: RequestInit; body: Record<string, unknown> | null }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, init, body });
    const r = replies[url.slice(SERVER.length)];
    if (r === undefined) throw new Error('offline');
    return { json: async () => (typeof r === 'function' ? r(body) : r) };
  };
  return { api: new ServerApi(fetchFn, () => token), calls };
}

export function signIn(store: SaveStore, extra: Record<string, unknown> = {}) {
  store.set('user', JSON.stringify({ name: 'Alex', email: 'alex@example.com', sub: '123', token: 'tok', ...extra }));
}
