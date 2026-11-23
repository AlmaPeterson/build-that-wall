// The CrazyGames SDK (v3, https://docs.crazygames.com/sdk/intro/), only when the game runs on CrazyGames.
// Everywhere else (our website, itch.io) nothing here loads or runs. Every call is guarded: an SDK problem
// never stops the game.

export interface CgUser { username: string; profilePictureUrl?: string }
export interface CgInviteParams { [k: string]: string | undefined }
interface CgSdk {
  init(): Promise<void>;
  environment: 'crazygames' | 'local' | 'disabled';
  user: { isUserAccountAvailable: boolean; getUser(): Promise<CgUser | null>; addAuthListener(fn: (u: CgUser | null) => void): void };
  game: {
    gameplayStart(): void; gameplayStop(): void; happytime(): void;
    settings: { muteAudio?: boolean; disableChat?: boolean };
    addSettingsChangeListener(fn: (s: { muteAudio?: boolean; disableChat?: boolean }) => void): void;
    isInstantMultiplayer?: boolean;
    inviteParams?: CgInviteParams | null;
    updateRoom(o: { roomId?: string; isJoinable?: boolean; inviteParams?: CgInviteParams }): void;
    leftRoom(): void;
    addJoinRoomListener(fn: (p: CgInviteParams) => void): void;
    inviteLink(p: CgInviteParams): string;
    getInviteParam(name: string): string | null;
  };
}
type CgWindow = { CrazyGames?: { SDK?: CgSdk } };

export const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/** Running on CrazyGames (or testing locally with ?useLocalSdk=true, which their SDK also uses). */
export function onCrazyGames(host = typeof location !== 'undefined' ? location.hostname : '', search = typeof location !== 'undefined' ? location.search : ''): boolean {
  return /(^|\.)crazygames\.[a-z.]+$/i.test(host) || /crazygames/i.test(host) || new URLSearchParams(search).get('useLocalSdk') === 'true';
}

/** The SDK, ready to use, or null (not on CrazyGames, or it didn't load). */
export class CrazyGames {
  private constructor(private readonly sdk: CgSdk) {}

  /** Load and start the SDK. Null when it can't be used here. Gives up after `timeout` ms. */
  static async start(o: { load?: (url: string) => Promise<void>; win?: object; timeout?: number } = {}): Promise<CrazyGames | null> {
    const win = (o.win ?? globalThis) as CgWindow;
    try {
      if (!win.CrazyGames?.SDK) await (o.load ?? loadScript)(SDK_URL);
      const sdk = win.CrazyGames?.SDK;
      if (!sdk) return null;
      await Promise.race([sdk.init(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), o.timeout ?? 8000))]);
      if (sdk.environment === 'disabled') return null;
      return new CrazyGames(sdk);
    } catch {
      return null;
    }
  }

  private safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }

  /** The CrazyGames player's username, or null for a guest. */
  async username(): Promise<string | null> {
    try { return this.sdk.user.isUserAccountAvailable ? (await this.sdk.user.getUser())?.username ?? null : null; } catch { return null; }
  }
  onLogin(fn: (username: string | null) => void): void { this.safe(() => this.sdk.user.addAuthListener(u => fn(u?.username ?? null)), undefined); }

  gameplayStart(): void { this.safe(() => this.sdk.game.gameplayStart(), undefined); }
  gameplayStop(): void { this.safe(() => this.sdk.game.gameplayStop(), undefined); }
  happytime(): void { this.safe(() => this.sdk.game.happytime(), undefined); }

  muted(): boolean { return this.safe(() => !!this.sdk.game.settings?.muteAudio, false); }
  onSettings(fn: (muted: boolean) => void): void { this.safe(() => this.sdk.game.addSettingsChangeListener(s => fn(!!s.muteAudio)), undefined); }

  /** Launched from a CrazyGames party: go straight into a new private room. */
  instantMultiplayer(): boolean { return this.safe(() => !!this.sdk.game.isInstantMultiplayer, false); }
  /** The room code the game was opened with (a CrazyGames invite link), or null. */
  invitedRoom(): string | null {
    return this.safe(() => this.sdk.game.inviteParams?.roomId ?? this.sdk.game.getInviteParam('roomId') ?? null, null);
  }
  onJoinRoom(fn: (roomId: string) => void): void {
    this.safe(() => this.sdk.game.addJoinRoomListener(p => { if (p?.roomId) fn(String(p.roomId)); }), undefined);
  }
  /** Tell CrazyGames which room the player is in and whether friends can still join it. */
  updateRoom(roomId: string, joinable: boolean): void {
    this.safe(() => this.sdk.game.updateRoom({ roomId, isJoinable: joinable, inviteParams: { roomId } }), undefined);
  }
  leftRoom(): void { this.safe(() => this.sdk.game.leftRoom(), undefined); }
  /** CrazyGames' own link that brings a friend into this room. */
  inviteLink(roomId: string): string | null { return this.safe(() => this.sdk.game.inviteLink({ roomId }), null); }
}

function loadScript(url: string): Promise<void> {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => ok(); s.onerror = () => no(new Error('load'));
    document.head.appendChild(s);
  });
}
