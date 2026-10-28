// A tiny observable value and a hook to use it in components. Enough for this game: no framework store.
import { useEffect, useState } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  subscribe(fn: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(v) { value = v; for (const fn of [...subs]) fn(v); },
    update(fn) { this.set(fn(value)); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

/** Re-render when the store changes. */
export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}
