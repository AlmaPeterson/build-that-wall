// Dev helper: open the app with ?demo to jump straight into a 3-player game (you + 2 bots).
// ?demo=watch shows 3 bots playing; ?demo=<number> plays that seed.
import { DEFAULT_SETTINGS } from '../../game';
import { controller, gameOptions, screen } from '../app-state';
import { GameController } from '../controller';

let started = false;

export function startDemoFromUrl(search = typeof location === 'undefined' ? '' : location.search): void {
  const q = new URLSearchParams(search).get('demo');
  if (started || q === null) return;
  started = true;
  const watch = q === 'watch';
  const seed = /^\d+$/.test(q) ? Number(q) : undefined;
  const c = new GameController(gameOptions);
  controller.set(c);
  screen.set('game');
  void c.start({ ...DEFAULT_SETTINGS, players: 3, bots: watch ? 3 : 2, difficulties: ['medium', 'hard', 'easy'] }, seed);
}
