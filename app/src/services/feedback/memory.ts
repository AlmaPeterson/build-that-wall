// What this player already sent, so the same idea or the same text is never sent twice

/** The few bits of saved data the feedback needs. Keys are stored as "btw:<key>" by the storage service. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

function readList<T>(store: KeyValueStore, key: string): T[] {
  try {
    const v: unknown = JSON.parse(store.get(key) || '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export class FeedbackMemory {
  constructor(private readonly store: KeyValueStore) {}

  /** Key words of every suggestion sent from this device (the last 300). */
  seen(): string[][] {
    return readList<string[]>(this.store, 'fbsent');
  }
  remember(keys: string[][]): void {
    this.store.set('fbsent', JSON.stringify(this.seen().concat(keys).slice(-300)));
  }

  /** The exact text, lowercased with spaces squashed: pasting the same message twice is caught. */
  static rawKey(subject: string, message: string): string {
    return (subject + ' ' + message).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  sentRaw(key: string): boolean {
    return readList<string>(this.store, 'fbraw').includes(key);
  }
  rememberRaw(key: string): void {
    this.store.set('fbraw', JSON.stringify(readList<string>(this.store, 'fbraw').concat([key]).slice(-50)));
  }
}
