// Gold sales on six days of the year: Easter, Independence Day, Thanksgiving, Black Friday, Silver Saturday
// (the last Saturday before Christmas, also called Super Saturday) and Christmas. Dates are worked out for
// any year, in the player's own time zone.

/** Easter Sunday (the same sum as the holiday card backs use). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1);
}

export type SaleId = 'easter' | 'independence-day' | 'thanksgiving' | 'black-friday' | 'silver-saturday' | 'christmas';

export const SALE_NAMES: Record<SaleId, string> = {
  easter: 'Easter', 'independence-day': 'Independence Day', thanksgiving: 'Thanksgiving',
  'black-friday': 'Black Friday', 'silver-saturday': 'Silver Saturday', christmas: 'Christmas',
};

export interface Sale { id: SaleId; name: string; year: number; from: Date; to: Date }   // to: the last day (whole day)

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const addDays = (dt: Date, n: number) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);

/** The 4th Thursday of November. */
export function thanksgiving(year: number): Date {
  const first = day(year, 11, 1);
  return day(year, 11, 1 + ((4 - first.getDay() + 7) % 7) + 21);
}

/** The last Saturday before Christmas Day. */
export function silverSaturday(year: number): Date {
  const xmas = day(year, 12, 25);
  return addDays(xmas, -(((xmas.getDay() + 1) % 7) || 7));
}

/** Every sale in a year, in date order. */
export function salesIn(year: number): Sale[] {
  const e = easterSunday(year), t = thanksgiving(year);
  const list: [SaleId, Date, Date][] = [
    ['easter', addDays(e, -2), addDays(e, 1)],                  // Good Friday to Easter Monday
    ['independence-day', day(year, 7, 1), day(year, 7, 4)],
    ['thanksgiving', t, t],
    ['black-friday', addDays(t, 1), addDays(t, 1)],
    ['silver-saturday', silverSaturday(year), silverSaturday(year)],
    ['christmas', day(year, 12, 24), day(year, 12, 26)],
  ];
  return list.map(([id, from, to]) => ({ id, name: SALE_NAMES[id], year, from, to }));
}

/** The sale on now, if any. */
export function saleOn(now: Date = new Date()): Sale | null {
  const today = day(now.getFullYear(), now.getMonth() + 1, now.getDate()).getTime();
  return salesIn(now.getFullYear()).find(s => today >= s.from.getTime() && today <= s.to.getTime()) ?? null;
}

/** A price with the sale taken off, to the cent. */
export const salePrice = (price: number, percent: number): number => Math.round(price * (100 - percent)) / 100;

/** "today only" or "until Monday 6 April". */
export function saleEnds(s: Sale): string {
  if (s.from.getTime() === s.to.getTime()) return 'today only';
  return 'until ' + s.to.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
