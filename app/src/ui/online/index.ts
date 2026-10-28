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
});

export { OnlineSession } from './session';
export { HostController } from './host';
export { OnlineClientController } from './client';
