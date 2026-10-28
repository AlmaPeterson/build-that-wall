import type { Entitlements } from '../gold/entitlements';
import { ACCOUNT_KEYS, type SaveStore } from '../storage';
import { isError, isServerUrl, type Entitlements as ServerEntitlements, type ServerApi } from './api';
import { accountId, getUser, setUser, userEmail, verifiedUser } from './user';

// SHA-256 of the owner's email, lowercased. The server checks OWNER_EMAIL for real; this only shows owner tools.
export const OWNER_EMAIL_SHA256 = 'f27ff759e0e7b427a39011639395ca15ee74b6aff0faf9e80f6d96059442c6db';

export interface AdminRow { id: string; name: string; games: number }

export async function sha256Hex(s: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const b = await subtle.digest('SHA-256', new TextEncoder().encode(String(s).trim().toLowerCase()));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// The player's account on the game server: saves that follow them to every device, their name, scores, owner tools
export class AccountService {
  constructor(
    private readonly store: SaveStore,
    private readonly ent: Entitlements,
    private readonly api: ServerApi,
  ) {}

  private useServer(server: string) { return !!verifiedUser(this.store) && isServerUrl(server); }

  async load(server: string): Promise<string> {
    if (!verifiedUser(this.store)) return 'local';
    const r = await this.api.call<ServerEntitlements>(server, '/load', {});
    if (!r) return 'noserver'; if (isError(r)) return r.error;
    this.ent.applyServer(r); return 'ok';
  }

  // Fire and forget, like before
  save(server: string): void {
    if (!verifiedUser(this.store)) return;
    const data: Record<string, string> = {};
    for (const k of ACCOUNT_KEYS) data[k] = this.store.get(k);
    void this.api.call(server, '/save', { data });
  }

  // Deletes the server account (if any) and this device's saves for it
  async delete(server: string): Promise<string> {
    let r = 'local';
    if (this.useServer(server)) {
      const x = await this.api.call(server, '/delete', {});
      r = !x ? 'noserver' : isError(x) ? x.error : 'ok';
    }
    const signInExpired = isExpired(getUser(this.store)?.exp);
    this.store.removeStash(accountId(this.store));
    setUser(this.store, null);
    this.store.clearLocal(signInExpired);
    this.ent.setCodes([]);
    return r;
  }

  // Forget this device's saves (keeps the sign-in unless it has expired)
  clearLocal(): void {
    this.store.clearLocal(isExpired(getUser(this.store)?.exp));
    this.ent.setCodes([]);
  }

  // Player names are unique on the server
  async claimName(server: string, name: string): Promise<string> {
    if (!this.useServer(server)) return 'local';
    const r = await this.api.call(server, '/name', { name: String(name) });
    if (!r) return 'noserver'; return isError(r) ? r.error : 'ok';
  }

  postScore(server: string, s: { miles: number; won: boolean; walls: number; name: string }): void {
    if (!getUser(this.store)) return;
    void this.api.call(server, '/score', { miles: +s.miles || 0, won: !!s.won, walls: +s.walls || 0, name: String(s.name).slice(0, 20) });
  }

  // ---- owner tools
  async ownerCheck(): Promise<boolean> {
    const mail = userEmail(this.store);
    try { this.ent.isOwner = !!mail && (await sha256Hex(mail)) === OWNER_EMAIL_SHA256; } catch { this.ent.isOwner = false; }
    return this.ent.isOwner;
  }

  isOwner(): boolean { return this.ent.isOwner; }

  // Up to 9 players. Without a server it searches this device's leaderboard.
  async adminSearch(server: string, query: string): Promise<AdminRow[]> {
    const q = String(query || '').trim().toLowerCase();
    let rows: AdminRow[] = [];
    if (this.useServer(server)) {
      const r = await this.api.call<{ users?: AdminRow[] }>(server, '/admin/search', { q });
      rows = (r && !isError(r) && r.users) || [];
    } else {
      const lb = this.store.getJson<Record<string, { games?: number }>>('lb', {});
      rows = Object.keys(lb).filter(n => n.toLowerCase().includes(q)).map(n => ({ id: 'local:' + n, name: n, games: lb[n]?.games || 0 }));
    }
    return rows.slice(0, 9);
  }

  async adminDelete(server: string, id: string): Promise<string> {
    id = String(id);
    if (id.startsWith('local:')) {
      const lb = this.store.getJson<Record<string, unknown>>('lb', {});
      delete lb[id.slice(6)];
      this.store.setJson('lb', lb);
      return 'ok';
    }
    const r = await this.api.call(server, '/admin/delete', { id });
    return !r ? 'noserver' : isError(r) ? r.error : 'ok';
  }
}

const isExpired = (exp?: number) => !!exp && exp * 1000 < Date.now();
