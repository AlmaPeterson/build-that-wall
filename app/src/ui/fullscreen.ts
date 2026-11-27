// Full screen: a button on the home page and in the game, and phones go full screen by themselves when a game starts.
// Browsers only allow full screen straight after a tap, so starting a game from a button works; a game that opens by
// itself (a saved game brought back on reload, or a guest's online game the host started) just stays as it is.
// iPhones don't let web pages go full screen, so there's no button there. Not on CrazyGames: it has its own.
import { controller } from './app-state';
import { onCG } from './platform';
import { createStore } from './store';

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
const doc = () => document as FsDoc;

const current = () => doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;

/** Full screen is possible here. */
export function canFullscreen(): boolean {
  if (typeof document === 'undefined' || onCG()) return false;
  return !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
}

/** The game is full screen right now. */
export const isFullscreen = createStore<boolean>(false);
if (typeof document !== 'undefined') {
  const sync = () => isFullscreen.set(!!current());
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
}

export function enterFullscreen(): void {
  if (!canFullscreen() || current()) return;
  const el = document.documentElement as FsEl;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    void Promise.resolve(p).catch(() => {});   // refused (no tap just before): carry on as normal
  } catch { /* old browsers throw instead */ }
}

export function exitFullscreen(): void {
  if (!current()) return;
  try {
    const p = doc().exitFullscreen ? doc().exitFullscreen() : doc().webkitExitFullscreen?.();
    void Promise.resolve(p).catch(() => {});
  } catch { /* ignore */ }
}

export function toggleFullscreen(): void {
  if (current()) exitFullscreen(); else enterFullscreen();
}

/** A phone (or small tablet): a touch screen whose shorter side is a phone's. */
export function onPhone(): boolean {
  if (typeof matchMedia === 'undefined' || typeof window === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= 600;
}

// Phones: full screen as each game starts (not on coming back from Settings, so leaving full screen sticks)
let last = controller.get();
controller.subscribe(c => {
  if (c && c !== last && onPhone()) enterFullscreen();
  last = c;
});
