import { render } from 'preact';
import { App } from './ui/app';
import './ui/theme.css';
import './ui/replay';                 // records games for Gold replays (before a saved game is brought back)
import { clearSavedGame, resumeSavedGame } from './ui/saved-game';
import { controller, screen } from './ui/app-state';
import { githubReturn } from './services/account';

const root = document.getElementById('app')!;

// This is GitHub's sign-in pop-up coming back: it hands the code to the game and closes, so don't start a game here
const githubPopup = githubReturn(location.search) === 'popup';

// Back into a game on this device that was left part-way (reloaded, or closed by accident). Not for ?demo.
const resumed = !githubPopup && !new URLSearchParams(location.search).has('demo') && resumeSavedGame();

if (githubPopup) root.textContent = 'Signing in…';
else try {
  render(<App />, root);
} catch (e) {
  if (!resumed) throw e;
  // The saved game couldn't be shown: forget it and open the menu instead of a blank page
  console.error(e);
  controller.set(null);
  screen.set('menu');
  clearSavedGame();
  render(<App />, root);
}

// The game was briefly installable with an offline helper (service worker). It's a website only now: remove it.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => void r.unregister())).catch(() => {});
  if ('caches' in globalThis) void caches.keys().then(ks => ks.filter(k => k.startsWith('btw-')).forEach(k => void caches.delete(k))).catch(() => {});
}
