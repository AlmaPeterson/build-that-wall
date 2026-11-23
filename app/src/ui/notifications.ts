// The notification bell's list, and what this player has read. Read notifications are kept in
// "btw:noteread"; "btw:notesince" is when this device first opened the game, so a new player isn't greeted
// by every old version. The owner's feedback inbox comes from the game server, and its read marks are kept there.
import { onCG } from './platform';
import changelog from '../data/changelog.json';
import { PACK_ANNOUNCEMENTS } from '../data/announcements';
import { isSignedIn } from '../services/account';
import { isError } from '../services/account/api';
import { buildNotices, isUnread, type FeedbackItem, type Notice, type SaleInfo, type Version } from '../services/notices/notices';
import { saleOn } from '../services/notices/sales';
import { services } from './services';
import { createStore } from './store';

export const VERSIONS = changelog as Version[];
export const notices = createStore<{ list: Notice[]; unread: number; owner: boolean }>({ list: [], unread: 0, owner: false });

const READ_KEY = 'noteread', SINCE_KEY = 'notesince';
let feedback: FeedbackItem[] = [];
let owner = false;

function readSet(): Set<string> {
  const l = services.store.getJson<string[]>(READ_KEY, []);
  return new Set(Array.isArray(l) ? l : []);
}

function since(): number {
  const had = +services.store.get(SINCE_KEY);
  if (had > 0) return had;
  // First visit: older versions don't count as news, so start a day before the latest one
  const latest = VERSIONS[0] ? new Date(VERSIONS[0].date + 'T00:00:00').getTime() : Date.now();
  services.store.set(SINCE_KEY, String(latest - 86400000));
  return latest - 86400000;
}

/** The sale on today, when it can be shown honestly: payments are off (it says so) or the sale's PayPal plans are set up. */
export function saleNow(now = new Date()): SaleInfo | null {
  const sale = saleOn(now);
  if (!sale || onCG()) return null;              // no Gold for sale on CrazyGames
  const c = services.config.get();
  const paymentsOff = services.paymentsOff;
  if (!paymentsOff && !(c.paypalPlanYearSale || c.paypalPlanMonthSale)) return null;
  return { sale, percent: c.salePercent, yearPrice: c.goldPriceYear, monthPrice: c.goldPriceMonth, currency: c.currency, paymentsOff };
}

/** Build the list again from what's known now. */
export function showNotices(): void {
  const read = readSet();
  const list = buildNotices({ versions: VERSIONS, packs: PACK_ANNOUNCEMENTS, sale: saleNow(), feedback, since: since() });
  notices.set({ list, unread: list.filter(n => isUnread(n, read)).length, owner });
}

/** Signed in as the owner: fetch the players' feedback from the game server. Others are told no, and nothing shows. */
export async function loadInbox(): Promise<void> {
  const server = services.server();
  if (!server || !isSignedIn(services.store)) { owner = false; feedback = []; showNotices(); return; }
  const r = await services.api.call<{ items?: FeedbackItem[] }>(server, '/admin/inbox', {});
  owner = !!r && !isError(r) && Array.isArray(r.items);
  feedback = owner ? (r as { items: FeedbackItem[] }).items : [];
  showNotices();
}

/** Mark notifications read (feedback: on the owner's account, so it's read on every device). */
export function markRead(ids: string[]): void {
  const read = readSet();
  for (const id of ids) read.add(id);
  services.store.setJson(READ_KEY, [...read].slice(-300));
  const fb = ids.filter(id => id.startsWith('fb:')).map(id => id.slice(3));
  if (fb.length) {
    feedback = feedback.map(f => (fb.includes(f.id) ? { ...f, read: true } : f));
    const server = services.server();
    if (server) void services.api.call(server, '/admin/inbox-read', { ids: fb });
  }
  showNotices();
}

export const unreadIn = (list: Notice[]): string[] => { const read = readSet(); return list.filter(n => isUnread(n, read)).map(n => n.id); };
