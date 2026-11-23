// Where the game is running, for the few things that differ. On CrazyGames (ui/crazygames.ts): no sign-in,
// no outside ads, links or purchases, the CrazyGames username as your name, and CrazyGames can mute the sound.
import { onCrazyGames } from '../services/platform/crazygames';
import { createStore } from './store';

export const platform = createStore<{ crazyGames: boolean; username: string | null; muted: boolean }>({
  crazyGames: onCrazyGames(), username: null, muted: false,
});

/** Running on CrazyGames. */
export const onCG = () => platform.get().crazyGames;
