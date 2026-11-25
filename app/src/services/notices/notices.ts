// What the notification bell shows: new versions of the game, new expansion packs, holiday sales on Gold,
// and (for the owner only) the feedback players sent. Pure functions; ui/notifications.ts keeps what's read.
import { salePrice, saleEnds, type Sale } from './sales';

export type NoticeKind = 'feature' | 'pack' | 'sale' | 'feedback';

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  text: string;
  /** When it happened (ms since 1970), for the order and the date shown. */
  at: number;
  /** A short list under the text (a version's changes). */
  lines?: string[];
  /** Feedback: who sent it, the address to reply to, the device details and any files. */
  from?: string;
  replyTo?: string;
  device?: string;
  files?: { name: string; url: string }[];
  /** Feedback: read on the owner's account (on any device). */
  read?: boolean;
}

export interface Version { version: string; date: string; changes: string[] }
export interface PackNews { id: string; date: string; name: string; text: string }
export interface FeedbackItem {
  id: string; at: number; from: string; replyTo?: string; subject?: string; text: string; device?: string;
  files?: { name: string; url: string }[]; read?: boolean;
}

/** Local midnight of a YYYY-MM-DD date. */
const dayAt = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime(); };

export function versionNotice(v: Version): Notice {
  return {
    id: 'v' + v.version, kind: 'feature', at: v.date ? dayAt(v.date) : 0,
    title: 'New in version ' + v.version,
    text: v.changes.length === 1 ? v.changes[0]! : v.changes.length + ' changes came out.',
    lines: v.changes.length > 1 ? v.changes.slice(0, 6) : undefined,
  };
}

export function packNotice(p: PackNews): Notice {
  return { id: 'pack:' + p.id, kind: 'pack', at: dayAt(p.date), title: 'New expansion pack: ' + p.name, text: p.text };
}

export interface SaleInfo { sale: Sale; percent: number; yearPrice: number; monthPrice: number; currency: string; paymentsOff: string }

export function saleNotice({ sale, percent, yearPrice, monthPrice, currency, paymentsOff }: SaleInfo): Notice {
  const money = (n: number) => n.toFixed(2) + ' ' + currency;
  return {
    id: 'sale:' + sale.id + ':' + sale.year, kind: 'sale', at: sale.from.getTime(),
    title: sale.name + ' sale: ' + percent + '% off Gold',
    text: 'Gold is ' + money(salePrice(yearPrice, percent)) + ' a year or ' + money(salePrice(monthPrice, percent)) + ' for 30 days, ' + saleEnds(sale) + '.' +
      (paymentsOff ? ' (Payments are turned off right now, so the sale can\'t be used yet. Reason: ' + paymentsOff + ')' : ' Get it on Account & Store.'),
  };
}

/** A player who may be in danger: this is no longer emailed, so it stays at the top of the bell until it's read. */
export const isUrgent = (n: Pick<Notice, 'kind' | 'title'>) => n.kind === 'feedback' && n.title.startsWith('🚨');

export function feedbackNotice(f: FeedbackItem): Notice {
  const urgent = /^URGENT/i.test(f.subject || '');
  return {
    id: 'fb:' + f.id, kind: 'feedback', at: f.at,
    title: urgent ? '🚨 URGENT: a player may need help (' + (f.from || 'a player') + ')' : 'Feedback' + (f.subject ? ': ' + f.subject : '') + ' from ' + (f.from || 'a player'),
    text: f.text, from: f.from, replyTo: f.replyTo, device: f.device, files: f.files, read: f.read,
  };
}

/** Everything for the bell, newest first. Versions older than `since` (the first visit) are left out, apart from the latest. */
export function buildNotices(o: {
  versions: Version[]; packs: PackNews[]; sale: SaleInfo | null; feedback: FeedbackItem[]; since?: number;
}): Notice[] {
  const versions = o.versions.map(versionNotice);
  const kept = versions.filter((v, i) => i === 0 || o.since === undefined || v.at >= o.since).slice(0, 10);
  return [...kept, ...o.packs.map(packNotice), ...(o.sale ? [saleNotice(o.sale)] : []), ...o.feedback.map(feedbackNotice)]
    .sort((a, b) => Number(isUrgent(b) && !b.read) - Number(isUrgent(a) && !a.read) || b.at - a.at);
}

/** Unread: not in the read list (feedback: not read on the owner's account). */
export const isUnread = (n: Notice, read: ReadonlySet<string>): boolean => (n.kind === 'feedback' ? !n.read : !read.has(n.id));
