// game-settings.json: the owner edits it and uploads it with the game. Empty = turned off / test mode.
// Keys keep their human-friendly names from the file.

export interface GameSettings {
  serverUrl: string;
  googleClientId: string;
  feedbackUrl: string;
  paypalClientId: string;
  paypalPlanMonth: string;
  paypalPlanYear: string;
  goldPriceLifetime: number;
  goldPriceYear: number;
  goldPriceMonth: number;
  currency: string;
  amazonTag: string;
  merchUrl: string;
  freeOnlinePlayers: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  serverUrl: '', googleClientId: '', feedbackUrl: '', paypalClientId: '', paypalPlanMonth: '', paypalPlanYear: '',
  goldPriceLifetime: 9.99, goldPriceYear: 19.99, goldPriceMonth: 2.99, currency: 'USD',
  amazonTag: '', merchUrl: '', freeOnlinePlayers: 4,
};

// File name → our name
const FILE_KEYS: Record<string, keyof GameSettings> = {
  'Server URL': 'serverUrl', 'Google Client ID': 'googleClientId', 'Feedback URL': 'feedbackUrl',
  'PayPal Client ID': 'paypalClientId', 'PayPal Plan Month': 'paypalPlanMonth', 'PayPal Plan Year': 'paypalPlanYear',
  'Gold Price Lifetime': 'goldPriceLifetime', 'Gold Price Year': 'goldPriceYear', 'Gold Price Month': 'goldPriceMonth',
  'Currency': 'currency', 'Amazon Tag': 'amazonTag', 'Merch URL': 'merchUrl', 'Free Online Players': 'freeOnlinePlayers',
};

// Turn the file's contents into settings; keys starting with "_" are notes, unknown keys are ignored
export function parseSettings(raw: unknown): GameSettings {
  const out: GameSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;
    const key = FILE_KEYS[k]; if (!key) continue;
    if (typeof DEFAULT_SETTINGS[key] === 'number') {
      const n = Number(v);
      if (v !== '' && v !== null && Number.isFinite(n)) (out[key] as number) = n;
    } else {
      (out[key] as string) = v === null || v === undefined ? '' : String(v);
    }
  }
  return out;
}

export type SettingsResult = { status: 'ok' | 'none' | 'error'; settings: GameSettings };

// Loads game-settings.json next to the page. Gives up after 3 seconds so a slow host never blocks the game.
export async function loadSettings(fetchFn: typeof fetch = fetch, url = 'game-settings.json', timeoutMs = 3000): Promise<SettingsResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return { status: 'none', settings: { ...DEFAULT_SETTINGS } };
    return { status: 'ok', settings: parseSettings(await r.json()) };
  } catch {
    return { status: 'error', settings: { ...DEFAULT_SETTINGS } };
  } finally {
    clearTimeout(timer);
  }
}
