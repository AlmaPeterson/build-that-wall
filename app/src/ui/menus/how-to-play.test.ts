// The public "How to play" page (public/how-to-play.html, for search engines and people who haven't
// started the game) repeats the in-game Instructions. This keeps the two from drifting apart.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSTRUCTION_PAGES } from './instructions';

const html = readFileSync(new URL('../../../public/how-to-play.html', import.meta.url), 'utf8')
  .replace(/&amp;/g, '&');
/** In the game only: zooming in and QR codes. The page says to tap a card instead. */
const GAME_ONLY = (p: string) => p.startsWith('Every other card explains itself.');

describe('how-to-play.html', () => {
  it('has every rule from the in-game Instructions', () => {
    const missing = INSTRUCTION_PAGES.flatMap(p => p.points).filter(p => !GAME_ONLY(p) && !html.includes(p));
    expect(missing).toEqual([]);
  });

  it('links back to the game', () => {
    expect(html).toContain('href="./"');
  });
});
