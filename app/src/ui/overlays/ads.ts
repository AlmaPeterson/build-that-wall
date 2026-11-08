// When the after-game video ad shows: players without Gold, once per game. Not while developing
// (the dev server), unless the address has ?ads, to preview them.
import { services } from '../services';

export const ads = {
  /** Should this player see an ad now? (Tests replace this.) */
  wanted(): boolean {
    if (services.player.get().gold) return false;
    if (import.meta.env.DEV) return typeof location !== 'undefined' && new URLSearchParams(location.search).has('ads');
    return true;
  },
};
