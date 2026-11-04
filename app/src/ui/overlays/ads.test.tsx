// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameController } from '../controller';
import { screen, settings } from '../app-state';
settings.update(s => ({ ...s, animSpeed: 'off' }));   // bot games finish at once
import { ads } from './ads';
import { Overlays } from './Overlays';
import { SKIP_SECONDS, VIDEO_ADS, VideoAd } from './VideoAd';

let root: HTMLElement;
const played: string[] = [];
beforeEach(() => {
  root = document.createElement('div'); document.body.appendChild(root);
  played.length = 0;
  // A stand-in for YouTube's player
  window.YT = { Player: class { constructor(_el: HTMLElement, o: object) { played.push((o as { videoId: string }).videoId); } destroy() {} playVideo() {} } };
});
afterEach(() => { render(null, root); root.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
const button = (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('VideoAd', () => {
  it('plays one of the ads; Skip unlocks after 10 seconds', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    act(() => render(<VideoAd storeUrl="https://example.com/store" onDone={done} />, root));
    await flush();
    expect(VIDEO_ADS.map(a => a.id)).toContain(played[0]);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/store');
    const skip = () => root.querySelector<HTMLButtonElement>('.btw-ad-skip')!;
    expect(skip().disabled).toBe(true);
    expect(skip().textContent).toBe('Skip in ' + SKIP_SECONDS);
    act(() => { vi.advanceTimersByTime((SKIP_SECONDS - 1) * 1000); });
    skip().click();
    expect(done).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(skip().textContent).toBe('Skip ad');
    act(() => skip().click());
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('shows the card-game ad when YouTube is unavailable', async () => {
    window.YT = undefined;
    const s = document.createElement('script');
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'script' ? s : document.createElementNS('http://www.w3.org/1999/xhtml', tag))) as typeof document.createElement);
    act(() => render(<VideoAd storeUrl="" onDone={() => {}} />, root));
    act(() => { s.onerror?.(new Event('error')); });
    await flush();
    expect(root.textContent).toContain('Play it for real with friends and family!');
    expect(root.querySelector('a')).toBeNull();          // no store link without one
  });
});

describe('after a game', () => {
  const finished = async () => {
    const c = new GameController();
    await c.start({ players: 3, bots: 3, difficulties: ['medium', 'medium', 'medium'], names: [], ending: 1, endingTimes: 1, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 11);
    act(() => render(<Overlays controller={c} />, root));
    return c;
  };

  it('players without Gold see the ad when they leave the win screen', async () => {
    vi.spyOn(ads, 'wanted').mockReturnValue(true);
    await finished();
    vi.useFakeTimers();
    act(() => button('Game log')!.click());
    expect(root.querySelector('.btw-ad')).not.toBeNull();
    expect(root.textContent).not.toContain('Play again');     // the ad first
    act(() => { vi.advanceTimersByTime(SKIP_SECONDS * 1000); });
    act(() => button('Skip ad')!.click());
    expect(root.querySelector('.btw-ad')).toBeNull();          // then the game log, as asked
  });

  it('Gold members never see it', async () => {
    vi.spyOn(ads, 'wanted').mockReturnValue(false);
    await finished();
    act(() => button('Back to menu')!.click());
    expect(root.querySelector('.btw-ad')).toBeNull();
    expect(screen.get()).toBe('menu');
  });
});
