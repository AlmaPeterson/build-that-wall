// Talks to game-server.gs. Request and response shapes match handleApi_ there.

export type ServerError = 'login' | 'server' | 'unknown' | 'used' | 'empty' | 'taken' | 'notfree' | 'owner'
  | 'order' | 'notpaid' | 'amount' | 'nosub' | (string & {});

export interface GoldGrant { plan?: string; exp: number; sub?: string; cancelled?: boolean }

// What /load, /trial, /claim-pack and /paypal/* send back
export interface Entitlements {
  packs?: string[];
  trialUsed?: boolean;
  gold?: GoldGrant;
  data?: Record<string, string>;
}

export interface ApiError { error: ServerError }

export type FetchLike = (url: string, init?: RequestInit) => Promise<{ json(): Promise<unknown> }>;

export const isError = (r: unknown): r is ApiError => !!r && typeof r === 'object' && 'error' in r && !!(r as ApiError).error;

// Only https servers are used (a Google Apps Script web app)
export const isServerUrl = (url: string) => /^https:/.test(String(url));

export class ServerApi {
  constructor(private readonly fetchFn: FetchLike, private readonly token: () => string) {}

  // POST {id_token, ...body}; body null = GET. Returns null when there's no server or it can't be reached.
  async call<T = unknown>(base: string, path: string, body: Record<string, unknown> | null): Promise<T | ApiError | null> {
    base = String(base || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(base)) return null;
    try {
      // Plain text keeps it a "simple" request, so a Google Apps Script server can answer it
      const r = await this.fetchFn(base + path, body === null ? {} : {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ id_token: this.token() }, body)),
      });
      return await r.json() as T | ApiError;
    } catch { return null; }
  }
}
