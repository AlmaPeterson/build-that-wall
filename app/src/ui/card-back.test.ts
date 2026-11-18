// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { cardImage } from './assets';
import { BACKS, backImageFor, easterSunday, holidayOn } from './card-back';

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('holidays', () => {
  it('finds each holiday near its date', () => {
    expect(holidayOn(day(2026, 12, 31))).toBe('new-year');
    expect(holidayOn(day(2027, 1, 2))).toBe('new-year');
    expect(holidayOn(day(2026, 12, 20))).toBe('christmas');
    expect(holidayOn(day(2026, 2, 10))).toBe('valentines-day');
    expect(holidayOn(day(2026, 3, 17))).toBe('st-patricks-day');
    expect(holidayOn(day(2026, 4, 1))).toBe('april-fools');
    expect(holidayOn(day(2026, 7, 4))).toBe('independence-day');
    expect(holidayOn(day(2026, 10, 31))).toBe('halloween');
    expect(holidayOn(day(2026, 11, 26))).toBe('thanksgiving');
  });

  it('shows Labor Day the week before the first Monday of September', () => {
    expect(holidayOn(day(2026, 9, 7))).toBe('labor-day');       // Labor Day 2026
    expect(holidayOn(day(2026, 8, 31))).toBe('labor-day');
    expect(holidayOn(day(2026, 8, 30))).toBe(null);
    expect(holidayOn(day(2026, 9, 8))).toBe(null);
    expect(holidayOn(day(2027, 9, 6))).toBe('labor-day');       // Labor Day 2027
  });

  it('finds Easter from Palm Sunday to Easter Sunday', () => {
    expect(easterSunday(2026)).toEqual(day(2026, 4, 5));
    expect(easterSunday(2027)).toEqual(day(2027, 3, 28));
    expect(easterSunday(2028)).toEqual(day(2028, 4, 16));
    expect(holidayOn(day(2026, 3, 29))).toBe('easter');        // Palm Sunday
    expect(holidayOn(day(2026, 4, 5))).toBe('easter');
    expect(holidayOn(day(2026, 4, 6))).toBe(null);
    expect(holidayOn(day(2026, 4, 1))).toBe('april-fools');    // April Fools' Day wins inside Holy Week
    expect(backImageFor({ gold: true, choice: BACKS.holiday, date: day(2026, 4, 3) })).toBe('assets/cards/hol-easter.jpg');
  });

  it('has no holiday on ordinary days', () => {
    expect(holidayOn(day(2026, 4, 20))).toBe(null);
    expect(holidayOn(day(2026, 5, 15))).toBe(null);
  });
});

describe('card back', () => {
  const christmas = day(2026, 12, 20);

  it('is the classic back unless a Gold player picked the holiday special near a holiday', () => {
    expect(backImageFor({ gold: true, choice: BACKS.classic, date: christmas })).toBe(cardImage(4));
    expect(backImageFor({ gold: false, choice: BACKS.holiday, date: christmas })).toBe(cardImage(4));
    expect(backImageFor({ gold: true, choice: BACKS.holiday, date: day(2026, 5, 15) })).toBe(cardImage(4));
    expect(backImageFor({ gold: true, choice: BACKS.holiday, date: christmas })).toBe('assets/cards/hol-christmas.jpg');
  });

  it('uses the Christmas back for New Year and the wall back for Labor Day', () => {
    expect(backImageFor({ gold: true, choice: BACKS.holiday, date: day(2027, 1, 1) })).toBe('assets/cards/hol-christmas.jpg');
    expect(backImageFor({ gold: true, choice: BACKS.holiday, date: day(2026, 9, 7) })).toBe('assets/cards/hol-labor-day.jpg');
  });

  it("shows a card's front on April Fools' Day, the same one for the same pile", () => {
    const fools = (seed: number) => backImageFor({ gold: true, choice: BACKS.holiday, date: day(2026, 4, 1), seed });
    expect(fools(30)).not.toBe(cardImage(4));
    expect(fools(30)).toBe(fools(30));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(fools)).size).toBeGreaterThan(1);
  });
});
