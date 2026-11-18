// Songs the player added from their computer. They're kept in this browser (IndexedDB), so they're still
// there next time; when the browser won't keep them (private windows, tests) they last until the page closes.
import { createStore } from '../store';

export interface MySong { id: string; name: string; blob: Blob }

const DB = 'btw-music', STORE = 'songs';
/** The most a player can add, so a browser's storage doesn't fill up. */
export const MAX_SONG_BYTES = 200 * 1024 * 1024;

/** The player's songs, in the order they were added. */
export const mySongs = createStore<MySong[]>([]);

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
}

async function withStore(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(res => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); res(req ? req.result : null); };
      tx.onerror = tx.onabort = () => { db.close(); res(null); };
    } catch { db.close(); res(null); }
  });
}

let loaded: Promise<void> | null = null;

/** Brings back the songs saved in this browser. Safe to call many times. */
export function loadMySongs(): Promise<void> {
  loaded ??= withStore('readonly', s => s.getAll()).then(rows => {
    const saved = (Array.isArray(rows) ? rows : []) as (MySong & { added?: number })[];
    saved.sort((a, b) => (a.added ?? 0) - (b.added ?? 0));
    if (saved.length) mySongs.set([...saved.map(({ id, name, blob }) => ({ id, name, blob })), ...mySongs.get()]);
  });
  return loaded;
}

/** Adds song files. Files that aren't sound, or that go over the limit, are left out; says how many were added. */
export async function addMySongs(files: File[]): Promise<number> {
  let used = mySongs.get().reduce((n, s) => n + s.blob.size, 0), added = 0;
  for (const f of files) {
    if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name)) continue;
    if (used + f.size > MAX_SONG_BYTES) continue;
    const song: MySong = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: f.name.replace(/\.[^.]+$/, ''), blob: f };
    used += f.size; added++;
    mySongs.set([...mySongs.get(), song]);
    await withStore('readwrite', s => s.put({ ...song, added: Date.now() + added }));
  }
  return added;
}

export async function removeMySong(id: string): Promise<void> {
  mySongs.set(mySongs.get().filter(s => s.id !== id));
  await withStore('readwrite', s => s.delete(id));
}

/** Opens the computer's file picker for song files. Resolves to the files picked (none if cancelled). */
export function pickSongFiles(): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*'; input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
