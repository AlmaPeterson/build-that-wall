// Your name: the one the game shows for you (Player 1 on this device, online, on the leaderboard). Changed on
// the home page or on Account & Store; both save it the same way.
import { cleanName } from '../../services/online';
import { settings } from '../app-state';
import { MAX_PLAYERS, updateSettings } from '../menus/prefs';
import { services } from '../services';

/** Save your name. Returns 'ok' | 'local' | 'noserver' (saved), 'empty', 'taken' or another error (see nameMessage). */
export async function saveMyName(typed: string): Promise<string> {
  const clean = cleanName(typed);
  if (!clean) return 'empty';
  const r = services.player.get().verified ? await services.account.claimName(services.server(), clean) : 'local';
  if (r === 'ok' || r === 'local' || r === 'noserver') {
    services.store.set('name', clean);
    // Player 1's name in the game settings is the same player, not a competing source of truth
    const g = settings.get().game;
    updateSettings(s => ({ ...s, game: { ...s.game, names: Array.from({ length: MAX_PLAYERS }, (_, i) => i === 0 ? clean : g.names[i] ?? '') } }));
  }
  services.refresh();
  return r;
}
