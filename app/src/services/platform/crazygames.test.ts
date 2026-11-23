import { describe, expect, it, vi } from 'vitest';
import { CrazyGames, onCrazyGames } from './crazygames';

function fakeSdk(over: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const log = (name: string) => (...a: unknown[]) => { calls.push([name, ...a]); };
  const sdk = {
    init: async () => {}, environment: 'crazygames',
    user: { isUserAccountAvailable: true, getUser: async () => ({ username: 'CoolPlayer' }), addAuthListener: log('auth') },
    game: {
      gameplayStart: log('start'), gameplayStop: log('stop'), happytime: log('happy'),
      settings: { muteAudio: true }, addSettingsChangeListener: log('settings'),
      isInstantMultiplayer: true, inviteParams: { roomId: 'ABCDE' },
      updateRoom: log('updateRoom'), leftRoom: log('leftRoom'), addJoinRoomListener: log('join'),
      inviteLink: (p: { roomId: string }) => 'https://www.crazygames.com/game/build-that-wall?roomId=' + p.roomId,
      getInviteParam: () => null,
    },
    ...over,
  };
  return { win: { CrazyGames: { SDK: sdk } }, calls };
}

describe('CrazyGames', () => {
  it('only switches on on CrazyGames, or for local testing with ?useLocalSdk=true', () => {
    expect(onCrazyGames('build-that-wall.game-files.crazygames.com', '')).toBe(true);
    expect(onCrazyGames('www.crazygames.com', '')).toBe(true);
    expect(onCrazyGames('localhost', '?useLocalSdk=true')).toBe(true);
    expect(onCrazyGames('almapeterson.github.io', '')).toBe(false);
    expect(onCrazyGames('html-classic.itch.zone', '')).toBe(false);
  });

  it('reads the username, mute, invites and Instant Multiplayer, and reports the room', async () => {
    const { win, calls } = fakeSdk();
    const cg = (await CrazyGames.start({ win, load: async () => {} }))!;
    expect(await cg.username()).toBe('CoolPlayer');
    expect(cg.muted()).toBe(true);
    expect(cg.instantMultiplayer()).toBe(true);
    expect(cg.invitedRoom()).toBe('ABCDE');
    expect(cg.inviteLink('QVPMQ')).toBe('https://www.crazygames.com/game/build-that-wall?roomId=QVPMQ');
    cg.updateRoom('QVPMQ', true); cg.leftRoom(); cg.gameplayStart();
    expect(calls).toEqual([['updateRoom', { roomId: 'QVPMQ', isJoinable: true, inviteParams: { roomId: 'QVPMQ' } }], ['leftRoom'], ['start']]);
  });

  it('is off when the SDK says it is disabled, fails to load, or never starts', async () => {
    expect(await CrazyGames.start({ win: fakeSdk({ environment: 'disabled' }).win, load: async () => {} })).toBeNull();
    expect(await CrazyGames.start({ win: {}, load: async () => { throw new Error('x'); } })).toBeNull();
    vi.useFakeTimers();
    const never = CrazyGames.start({ win: fakeSdk({ init: () => new Promise(() => {}) }).win, load: async () => {}, timeout: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await never).toBeNull();
    vi.useRealTimers();
  });

  it('a guest has no username, and a broken SDK call never throws', async () => {
    const { win } = fakeSdk({ user: { isUserAccountAvailable: true, getUser: async () => null, addAuthListener: () => {} } });
    const cg = (await CrazyGames.start({ win, load: async () => {} }))!;
    expect(await cg.username()).toBeNull();
    (win.CrazyGames.SDK.game as Record<string, unknown>).updateRoom = () => { throw new Error('boom'); };
    expect(() => cg.updateRoom('X', true)).not.toThrow();
  });
});
