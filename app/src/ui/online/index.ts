// The app's online session, shared by the Online screen and the board.
import { myName } from '../../services/account';
import { KEYS } from '../../services/storage';
import { controller, screen, settings } from '../app-state';
import { services } from '../services';
import { installBackGuard } from './back-guard';
import { OnlineSession } from './session';

export const online = new OnlineSession({
  connect: services.connect,
  name: () => myName(services.store),
  baseSettings: () => settings.get().game,
  memory: services.botMemory,
  show: c => { controller.set(c); screen.set('game'); },
  autoJoin: () => settings.get().autoJoin,
  home: () => { controller.set(null); screen.set('menu'); },
  rejoinStore: {
    load: () => services.store.get(KEYS.online),
    save: v => { if (v === null) services.store.remove(KEYS.online); else services.store.set(KEYS.online, v); },
  },
});

// Another window or app in front: the others are told, so they don't decide this player has gone
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => online.pageVisible(document.visibilityState === 'visible'));
  addEventListener('pagehide', e => { if (!(e as PageTransitionEvent).persisted) online.pageClosing(); });
  // Back in a room or a game: close the popup, back to the game from a side screen, or "Leave the game?"
  // Armed from the tap that starts connecting: Chrome ignores a history entry added without one
  installBackGuard({
    active: () => online.state.get().phase !== 'idle' && online.state.get().phase !== 'ended',
    onBack: () => {
      if (online.state.get().phase === 'connecting') { online.leave(); screen.set('online'); return; }
      if (online.state.get().still || online.state.get().confirmLeave) return;
      if (online.state.get().phase === 'playing' && screen.get() !== 'game') online.backToGame();
      else online.askLeave();
    },
  }, fn => online.state.subscribe(fn));
  // The page was reloaded (or closed by accident) during an online game: straight back into it
  if (online.autoRejoinable()) { screen.set('online'); void online.rejoin(); }
  // Reloading or closing the page in a room or a game: the browser asks "Reload site?" / "Leave site?" first.
  // Only while in one: the listener stops the browser keeping the page in its back/forward cache.
  const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  let asking = false;
  online.state.subscribe(() => {
    const want = online.inRoom;
    if (want !== asking) { asking = want; if (want) addEventListener('beforeunload', ask); else removeEventListener('beforeunload', ask); }
  });
}

export { OnlineSession } from './session';
export { HostController } from './host';
export { OnlineClientController } from './client';
