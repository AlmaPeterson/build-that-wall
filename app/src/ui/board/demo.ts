// Dev helper: open the app with ?demo to jump straight into a 3-player game (you + 2 bots).
// ?demo=watch shows 3 bots playing; ?demo=pass is 2 people sharing the device + a bot; ?demo=<number> plays that seed.
import { DEFAULT_SETTINGS } from '../../game';
import { controller, gameOptions, screen } from '../app-state';
import { GameController } from '../controller';

let started = false;

export function startDemoFromUrl(search = typeof location === 'undefined' ? '' : location.search): void {
  const params = new URLSearchParams(search);
  const q = params.get('demo');
  if (started || q === null) return;
  started = true;
  const watch = q === 'watch', pass = q === 'pass';
  const n = /^\d+$/.test(q) ? q : params.get('seed') ?? '';   // ?demo=watch&seed=2 watches a known game
  const seed = /^\d+$/.test(n) ? Number(n) : undefined;
  const c = new GameController(gameOptions);
  controller.set(c);
  screen.set('game');
  void c.start({ ...DEFAULT_SETTINGS, players: 3, bots: watch ? 3 : pass ? 1 : 2, difficulties: pass ? ['medium'] : ['medium', 'hard', 'easy'] }, seed);
}
