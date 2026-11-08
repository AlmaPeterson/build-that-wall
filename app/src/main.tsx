import { render } from 'preact';
import { App } from './ui/app';
import './ui/theme.css';
import { clearSavedGame, resumeSavedGame } from './ui/saved-game';
import { controller, screen } from './ui/app-state';

const root = document.getElementById('app')!;

// Back into a game on this device that was left part-way (reloaded, or closed by accident). Not for ?demo.
const resumed = !new URLSearchParams(location.search).has('demo') && resumeSavedGame();

try {
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
