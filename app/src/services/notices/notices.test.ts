import { describe, expect, it } from 'vitest';
import { buildNotices, isUnread, saleNotice } from './notices';
import { saleOn, salesIn, salePrice, silverSaturday, thanksgiving } from './sales';

const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

describe('holiday sales', () => {
  it('fall on the right days', () => {
    expect(ymd(thanksgiving(2026))).toBe('2026-11-26');
    expect(ymd(silverSaturday(2026))).toBe('2026-12-19');          // Christmas 2026 is a Friday
    expect(ymd(silverSaturday(2027))).toBe('2027-12-18');          // Christmas 2027 is a Saturday: the one before
    expect(ymd(silverSaturday(2022))).toBe('2022-12-24');          // Christmas 2022 is a Sunday
    const s2026 = Object.fromEntries(salesIn(2026).map(s => [s.id, ymd(s.from) + '..' + ymd(s.to)]));
    expect(s2026).toEqual({
      easter: '2026-04-03..2026-04-06', 'independence-day': '2026-07-01..2026-07-04', thanksgiving: '2026-11-26..2026-11-26',
      'black-friday': '2026-11-27..2026-11-27', 'silver-saturday': '2026-12-19..2026-12-19', christmas: '2026-12-24..2026-12-26',
    });
  });

  it('are on only during those days', () => {
    expect(saleOn(new Date(2026, 10, 27, 23, 0))?.id).toBe('black-friday');
    expect(saleOn(new Date(2026, 10, 28, 0, 1))).toBeNull();
    expect(saleOn(new Date(2026, 11, 25, 12))?.id).toBe('christmas');
    expect(saleOn(new Date(2026, 6, 4))?.name).toBe('Independence Day');
    expect(salePrice(19.99, 25)).toBe(14.99);
  });

  it('say when payments are off', () => {
    const sale = saleOn(new Date(2026, 10, 27))!;
    const n = saleNotice({ sale, percent: 25, yearPrice: 19.99, monthPrice: 2.99, currency: 'USD', paymentsOff: 'Not Ready For Payments Yet' });
    expect(n.title).toBe('Black Friday sale: 25% off Gold');
    expect(n.text).toMatch(/14\.99 USD a year or 2\.24 USD for 30 days, today only/);
    expect(n.text).toMatch(/can't be used yet/);
  });
});

describe('the notification list', () => {
  const versions = [
    { version: '1.2', date: '2026-11-20', changes: ['Rematch', 'Bot names'] },
    { version: '1.1', date: '2026-11-10', changes: ['Stats'] },
    { version: '1.0', date: '2026-10-01', changes: ['First'] },
  ];
  it('has new versions since the first visit (always the latest), packs, the sale and feedback, newest first', () => {
    const list = buildNotices({
      versions, packs: [{ id: 'swamp', date: '2026-11-15', name: 'Swamp Pack', text: '5 new cards.' }], sale: null,
      feedback: [{ id: 'a1', at: new Date(2026, 10, 21).getTime(), from: 'Sam', text: 'Add dark mode', read: false }],
      since: new Date(2026, 10, 5).getTime(),
    });
    expect(list.map(n => n.id)).toEqual(['fb:a1', 'v1.2', 'pack:swamp', 'v1.1']);
    expect(list[1]!.lines).toEqual(['Rematch', 'Bot names']);
    expect(list[0]!.title).toBe('Feedback from Sam');
    expect(isUnread(list[0]!, new Set())).toBe(true);
    expect(isUnread(list[1]!, new Set(['v1.2']))).toBe(false);
  });

  it('a brand-new player only sees the latest version', () => {
    const list = buildNotices({ versions, packs: [], sale: null, feedback: [], since: Date.now() });
    expect(list.map(n => n.id)).toEqual(['v1.2']);
  });
});
