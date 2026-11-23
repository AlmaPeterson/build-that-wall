// The game on CrazyGames (https://docs.crazygames.com/requirements/multiplayer/): signed-in CrazyGames players
// play under their CrazyGames username; CrazyGames hears about the online room so its Invite button and invite
// links work; a party leader goes straight into a new private room (Instant Multiplayer); invite links join the
// room; CrazyGames' mute setting is followed; and it's told when a game is being played.
import { CrazyGames } from '../services/platform/crazygames';
import { screen } from './app-state';
import { onlineIntent } from './menus/start';
import { online } from './online';
import { pendingJoin } from './online/join-link';
import { MAX_SEATS } from './online/messages';
import { platform } from './platform';
import { services } from './services';

let cg: CrazyGames | null = null;

/** CrazyGames' own invite link for a room ('' when not on CrazyGames). */
export const cgInviteLink = (code: string) => cg?.inviteLink(code) ?? '';

/** Into a friend's room: now if the Online screen is open and free, else as soon as it opens. */
function joinRoom(code: string): void {
  if (online.state.get().phase !== 'idle') return;
  if (screen.get() === 'online') void online.join(code);
  else { pendingJoin.set(code); screen.set('online'); }
}

function useName(username: string | null): void {
  platform.set({ ...platform.get(), username });
  if (username) { services.store.set('name', username); services.refresh(); }
}

export async function startCrazyGames(): Promise<void> {
  cg = await CrazyGames.start();
  if (!cg) return;
  const sdk = cg;

  useName(await sdk.username());
  sdk.onLogin(useName);

  platform.set({ ...platform.get(), muted: sdk.muted() });
  sdk.onSettings(muted => platform.set({ ...platform.get(), muted }));

  // Gameplay on the board, not in menus
  let playing = false;
  const gameplay = (s: string) => { const now = s === 'game'; if (now !== playing) { playing = now; if (now) sdk.gameplayStart(); else sdk.gameplayStop(); } };
  gameplay(screen.get());
  screen.subscribe(gameplay);

  // The online room, for CrazyGames' Invite button and invite links
  let inRoom = '';
  online.state.subscribe(st => {
    const room = (st.phase === 'lobby' || st.phase === 'playing') && st.code ? st.code : '';
    if (room) { inRoom = room; sdk.updateRoom(room, st.phase === 'lobby' && st.players.length < MAX_SEATS); }
    else if (inRoom) { inRoom = ''; sdk.leftRoom(); }
  });

  // Opened from an invite link, or invited while already playing; or a party leader: straight into a new room
  sdk.onJoinRoom(joinRoom);
  const invited = sdk.invitedRoom();
  if (invited) joinRoom(invited);
  else if (sdk.instantMultiplayer() && online.state.get().phase === 'idle') { onlineIntent.set('host'); screen.set('online'); }
}
