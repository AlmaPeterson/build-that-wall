// The back of the cards: the classic back, or for Gold players who pick it, a holiday special that only
// shows near the holidays. On April Fools' Day the back is a random card's front, so the draw pile can show
// one card and hand over another.
import { cardImage } from './assets';
import { services } from './services';

/** Saved as "back", by name, exactly as the old game saved it (old saves and the game server keep working). */
export const BACKS = { classic: 'Classic', holiday: 'Holiday special (near holidays)' } as const;

export type Holiday = 'new-year' | 'valentines-day' | 'st-patricks-day' | 'april-fools' | 'easter' | 'independence-day'
  | 'labor-day' | 'halloween' | 'thanksgiving' | 'christmas';

export const HOLIDAY_NAMES: Record<Holiday, string> = {
  'new-year': 'New Year', 'valentines-day': "Valentine's Day", 'st-patricks-day': "St. Patrick's Day",
  'april-fools': "April Fools' Day", easter: 'Easter', 'independence-day': 'Independence Day', 'labor-day': 'Labor Day',
  halloween: 'Halloween', thanksgiving: 'Thanksgiving', christmas: 'Christmas',
};

// April Fools' Day has no picture: it borrows a card's front instead
const HOLIDAY_IMAGES: Record<Exclude<Holiday, 'april-fools'>, string> = {
  'new-year': 'assets/cards/hol-christmas.jpg',
  'valentines-day': 'assets/cards/hol-valentines-day.jpg',
  'st-patricks-day': 'assets/cards/hol-st-patricks-day.jpg',
  easter: 'assets/cards/hol-easter.jpg',
  'independence-day': 'assets/cards/hol-independence-day.jpg',
  'labor-day': 'assets/cards/hol-labor-day.jpg',
  halloween: 'assets/cards/hol-halloween.jpg',
  thanksgiving: 'assets/cards/hol-thanksgiving.jpg',
  christmas: 'assets/cards/hol-christmas.jpg',
};

/** Easter Sunday in a year (the Gregorian calendar's rule). */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1);
}

// Whole days from one date to a later one (ignores the time of day)
const daysBetween = (from: Date, to: Date) =>
  Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);

/** The holiday that is near on this date, if any. */
export function holidayOn(date: Date = new Date()): Holiday | null {
  const m = date.getMonth() + 1, d = date.getDate(), md = m * 100 + d;
  if (md >= 1228 || md <= 102) return 'new-year';
  if (md >= 1201 && md <= 1227) return 'christmas';
  if (md >= 207 && md <= 214) return 'valentines-day';
  if (md >= 310 && md <= 317) return 'st-patricks-day';
  if (md === 401) return 'april-fools';
  // Palm Sunday to Easter Sunday
  const toEaster = daysBetween(date, easterSunday(date.getFullYear()));
  if (toEaster >= 0 && toEaster <= 7) return 'easter';
  if (md >= 628 && md <= 705) return 'independence-day';
  // The week before Labor Day (the first Monday of September), and the day itself
  const laborDay = 1 + (8 - new Date(date.getFullYear(), 8, 1).getDay()) % 7;
  const daysBefore = daysBetween(date, new Date(date.getFullYear(), 8, laborDay));
  if (daysBefore >= 0 && daysBefore <= 7) return 'labor-day';
  if (md >= 1017 && md <= 1031) return 'halloween';
  if (md >= 1120 && md <= 1130) return 'thanksgiving';
  return null;
}

// Cards whose fronts April Fools' Day can show: the base game's cards, not the back itself or pack cards
const FOOLS_FRONTS = Array.from({ length: 44 }, (_, i) => i + 1).filter(id => id !== 4);

/** The back to show. `seed` picks April Fools' Day's fake front, so the same pile shows the same card. */
export function backImageFor(o: { gold: boolean; choice: string; date?: Date; seed?: number }): string {
  const holiday = o.gold && o.choice === BACKS.holiday ? holidayOn(o.date) : null;
  if (!holiday) return cardImage(4);
  if (holiday === 'april-fools') {
    const n = Math.abs(Math.imul((o.seed ?? 0) + 1, 2654435761) | 0);
    return cardImage(FOOLS_FRONTS[n % FOOLS_FRONTS.length]!, 'thumb');
  }
  return HOLIDAY_IMAGES[holiday];
}

/** The card back for this player right now. */
export function cardBackImage(seed = 0): string {
  return backImageFor({ gold: services.player.get().gold, choice: services.store.get('back'), seed });
}
