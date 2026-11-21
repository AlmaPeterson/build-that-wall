// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../../game';
import { GameController, type GameSnapshot } from '../controller';
import { CardVideos, VIDEO_CARDS, WatchVideosButton, needsMe, videosOpen } from './CardVideos';

/** A snapshot where it's `turn`'s turn and seat 0 is the one on this device. */
const snap = (turn: number, extra: Partial<GameSnapshot> = {}): GameSnapshot => ({
  view: { turn, over: null, seats: [{ bot: null }, { bot: 'medium' }] } as unknown as GameState,
  viewer: 0, events: [], prompt: null, passTo: null, ...extra,
});

describe('waiting for your move', () => {
  it('knows when the game needs someone on this device', () => {
    expect(needsMe(snap(0))).toBe(true);
    expect(needsMe(snap(1))).toBe(false);                          // a bot is playing
    expect(needsMe(snap(1, { turnBanner: 1 }))).toBe(false);
    expect(needsMe(snap(1, { passTo: 0 }))).toBe(true);
    expect(needsMe(snap(0, { turnBanner: 0 }))).toBe(true);
    expect(needsMe(snap(1, { openHands: true }))).toBe(false);    // only watching bots
  });
});

describe('Watch videos', () => {
  let root: HTMLElement, c: GameController;
  beforeEach(() => {
    root = document.createElement('div'); document.body.appendChild(root);
    c = new GameController();
    c.snapshot.set(snap(1));
  });
  afterEach(() => { act(() => { render(null, root); }); root.remove(); videosOpen.set(null); vi.useRealTimers(); });

  const show = () => act(() => { render(<><WatchVideosButton controller={c} /><CardVideos controller={c} /></>, root); });
  const button = (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  it('shows the button only while you wait, and every card with a page', () => {
    show();
    expect(button('Watch videos')).toBeDefined();
    act(() => { button('Watch videos')!.click(); });
    expect(root.querySelectorAll('.videos__grid li')).toHaveLength(VIDEO_CARDS.length);
    expect(VIDEO_CARDS.length).toBeGreaterThan(40);
    act(() => { c.snapshot.set(snap(0)); });
    expect(button('Watch videos')).toBeUndefined();
  });

  it("opens a card's QR code page inside the game", () => {
    show();
    act(() => { videosOpen.set('all'); });
    act(() => { (root.querySelector('.videos__grid button') as HTMLButtonElement).click(); });
    const frame = root.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(VIDEO_CARDS[0]!.link);
    act(() => { button('All cards')!.click(); });
    expect(root.querySelector('.videos__grid')).not.toBeNull();
  });

  it('buzzes, dings and wiggles a green X when it is your move again', () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    show();
    act(() => { videosOpen.set('all'); });
    expect(root.querySelector('.videos__x--go')).toBeNull();
    vi.advanceTimersByTime(5000);                                  // you waited a while
    act(() => { c.snapshot.set(snap(0)); });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.videos__x--go')).not.toBeNull();
    expect(root.querySelector('.videos__go')!.textContent).toContain("your move");
    act(() => { (root.querySelector('.videos__x') as HTMLButtonElement).click(); });
    expect(root.querySelector('.videos')).toBeNull();
  });
});
