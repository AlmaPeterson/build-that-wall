// The app's online session, shared by the Online screen and the board.
import { myName } from '../../services/account';
import { controller, screen, settings } from '../app-state';
import { services } from '../services';
import { OnlineSession } from './session';

export const online = new OnlineSession({
  connect: services.connect,
  name: () => myName(services.store),
  baseSettings: () => settings.get().game,
  memory: services.botMemory,
  show: c => { controller.set(c); screen.set('game'); },
  autoJoin: () => settings.get().autoJoin,
  home: () => { controller.set(null); screen.set('menu'); },
});

// Another window or app in front: the others are told, so they don't decide this player has gone
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => online.pageVisible(document.visibilityState === 'visible'));
  addEventListener('pagehide', e => { if (!(e as PageTransitionEvent).persisted) online.pageClosing(); });
}

export { OnlineSession } from './session';
export { HostController } from './host';
export { OnlineClientController } from './client';
