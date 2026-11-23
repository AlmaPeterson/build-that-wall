// Sound effects and background music. Sound effects follow the Sound Effects setting; music is a
// playlist of the game's own song, YouTube links, song links and the player's own song files (Cycle All / Play One).
import { settings, type UiSettings } from './app-state';
import { sound } from './assets';
import { playDefaultSong, songById, SONGS, type SongPlayer } from './music/default-song';
import { loadMySongs, mySongs, type MySong } from './music/my-songs';
import { createStore } from './store';

// The old game has two sounds: a button click and a card sound. Other names map onto them.
const SFX: Record<string, [sprite: string, name: string]> = {
  click: ['Buttons', 'click'],
  card: ['Cards', 'card'],
};
const ALIASES: Record<string, string> = { build: 'card', draw: 'card', play: 'card', deal: 'card', win: 'click', button: 'click' };

/** Plays a sound file; replaced in tests. */
export let makeAudio: (src: string) => { play(): Promise<unknown> | void; volume: number } =
  src => new Audio(src);
export function setAudioFactory(f: typeof makeAudio): void { makeAudio = f; }

/** Play a sound effect by name (e.g. 'card', 'click', 'build', 'win'). Does nothing when sound is off. */
export function playSfx(name: string): void {
  if (!settings.get().sound) return;
  const key = SFX[name] ? name : ALIASES[name];
  const entry = key ? SFX[key] : undefined;
  const path = entry ? sound(entry[0], entry[1]) : null;
  if (!path) return;
  try {
    const a = makeAudio(path);
    a.volume = 0.8;
    void Promise.resolve(a.play()).catch(() => { /* the browser blocked it until the player taps */ });
  } catch { /* no audio here */ }
}

/** A bright two-note ding (made by the browser, no file): it's your move. Follows the Sound Effects setting. */
export function playDing(): void {
  if (!settings.get().sound) return;
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [[1046.5, 0], [1568, 0.12]].forEach(([hz, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = hz!;
      g.gain.setValueAtTime(0.0001, now + at!);
      g.gain.exponentialRampToValueAtTime(0.35, now + at! + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at! + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(now + at!); o.stop(now + at! + 0.95);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch { /* no audio here */ }
}

/** A short fanfare when you win: a rising major arpeggio and a held chord, made with Web Audio (no file). */
export function playFanfare(): void {
  if (!settings.get().sound) return;
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes: [number, number, number][] = [[523.25, 0, 0.16], [659.25, 0.16, 0.16], [783.99, 0.32, 0.16], [1046.5, 0.48, 0.9],
      [659.25, 0.48, 0.9], [783.99, 0.48, 0.9]];
    for (const [hz, at, len] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.22, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
      o.connect(g).connect(ctx.destination);
      o.start(now + at); o.stop(now + at + len + 0.05);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 2000);
  } catch { /* no audio here */ }
}

// ---- background music

export type Track =
  | { type: 'default'; song?: string }                   // one of the game's own songs (music/default-song.ts)
  | { type: 'yt'; id: string }                           // a YouTube video
  | { type: 'ytlist'; list: string; id?: string }        // a YouTube playlist (starting at a video, maybe)
  | { type: 'url'; url: string }                         // a link to a song file
  | { type: 'file'; id: string; blob: Blob };            // a song from the player's computer

const hasDOM = typeof document !== 'undefined';
let playlist: Track[] = [];
let index = 0, volume = 0.5, playing = false, token = 0;
let audio: HTMLAudioElement | null = null, frame: HTMLIFrameElement | null = null, song: SongPlayer | null = null, blobUrl = '';

export function youtubeId(url: string): string | null {
  const m = String(url).match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1]! : null;
}

const SONG_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

/** What a link the player pasted plays: a YouTube video or playlist, or a song file on the web. Null if it can't be played. */
export function parseMusicLink(link: string): Track | null {
  const text = String(link).trim();
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(url.hostname)) {
    const list = url.searchParams.get('list');
    const id = youtubeId(text);
    if (list && /^[A-Za-z0-9_-]{10,}$/.test(list)) return id ? { type: 'ytlist', list, id } : { type: 'ytlist', list };
    return id ? { type: 'yt', id } : null;
  }
  return SONG_FILE.test(url.pathname) ? { type: 'url', url: url.toString() } : null;
}

const mode = () => settings.get().musicMode;

function ytCommand(func: string, args: unknown[] = []): void {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: token, channel: 'widget' }), '*');
}

function clearPlayer(): void {
  token++;
  if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; }
  if (frame) { frame.remove(); frame = null; }
  if (song) { song.stop(); song = null; }
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
}

function trackEnded(myToken: number): void {
  if (myToken !== token || !playing) return;
  if (mode() === 'cycle') index = (index + 1) % playlist.length;
  playCurrent();
}

// A song that won't play: try the next one (or stop, if it's the only one)
function trackFailed(myToken: number): void {
  if (myToken !== token || !playing) return;
  if (playlist.length < 2) { music.stop(); return; }
  setTimeout(() => { if (myToken !== token) return; index = (index + 1) % playlist.length; playCurrent(); }, 1000);
}

function playCurrent(): void {
  clearPlayer();
  if (!hasDOM || playlist.length === 0) { playing = false; return; }
  playing = true;
  index = ((index % playlist.length) + playlist.length) % playlist.length;
  const track = playlist[index]!;
  const myToken = token;
  // On its own a song loops for ever; with other songs after it, it plays through and the next one starts
  if (track.type === 'default') { song = playDefaultSong(volume, track.song, playlist.length > 1 ? () => trackEnded(myToken) : undefined); return; }
  if (track.type === 'file' || track.type === 'url') {
    if (track.type === 'file') blobUrl = URL.createObjectURL(track.blob);
    audio = new Audio(track.type === 'file' ? blobUrl : track.url);
    audio.volume = volume;
    audio.onended = () => trackEnded(myToken);
    audio.onerror = () => trackFailed(myToken);
    audio.play().catch(() => {});
    return;
  }
  // A hidden YouTube player; it tells us when the video ends so the next song can start. A playlist plays
  // through on its own (and starts over), so only Next moves on from it.
  const origin = encodeURIComponent(location.origin);
  const base = 'https://www.youtube-nocookie.com/embed/';
  const f = document.createElement('iframe');
  f.src = track.type === 'yt'
    ? `${base}${track.id}?autoplay=1&enablejsapi=1&origin=${origin}`
    : `${base}${track.id ?? 'videoseries'}?list=${track.list}&loop=1&autoplay=1&enablejsapi=1&origin=${origin}`;
  f.allow = 'autoplay; encrypted-media';
  f.setAttribute('aria-hidden', 'true');
  if (track.type === 'ytlist') f.dataset.list = '1';
  f.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;';
  f.onload = () => {
    const w = f.contentWindow;
    if (!w) return;
    w.postMessage(JSON.stringify({ event: 'listening', id: myToken, channel: 'widget' }), '*');
    w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: myToken, channel: 'widget' }), '*');
    ytCommand('setVolume', [Math.round(volume * 100)]);
  };
  frame = f;
  document.body.appendChild(f);
}

if (hasDOM && typeof window !== 'undefined') {
  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow) return;
    let data: { event?: string; info?: unknown } | null;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!data) return;
    const state = data.event === 'onStateChange' ? data.info
      : data.event === 'infoDelivery' && data.info ? (data.info as { playerState?: number }).playerState : undefined;
    if (data.event === 'onReady') ytCommand('setVolume', [Math.round(volume * 100)]);
    if (state === 0 && !frame.dataset.list) trackEnded(token);   // video finished
    if (data.event === 'onError') trackFailed(token);            // can't embed: skip
  });
}

/** What a track is, to tell whether the playlist changed. */
const trackKey = (t: Track) => (t.type === 'file' ? 'file:' + t.id : JSON.stringify(t));

export const music = {
  /** Play these tracks from the first one, unless they're the ones already playing. */
  setTracks(tracks: Track[]): void {
    const same = tracks.length === playlist.length && tracks.every((t, k) => trackKey(t) === trackKey(playlist[k]!));
    if (same && playing) return;
    if (!same) index = 0;
    playlist = [...tracks];
    playCurrent();
  },
  play(): void { if (playlist.length) playCurrent(); },
  next(): void { if (!playlist.length) return; index = (index + 1) % playlist.length; playCurrent(); },
  stop(): void { playing = false; clearPlayer(); },
  /** 0-100. */
  setVolume(percent: number): void {
    volume = Math.max(0, Math.min(1, percent / 100 || 0));
    if (audio) audio.volume = volume;
    song?.setVolume(volume);
    if (frame) ytCommand('setVolume', [Math.round(volume * 100)]);
  },
  count: () => playlist.length,
  number: () => (playlist.length ? index + 1 : 0),
  isPlaying: () => playing,
  current: (): Track | null => (playing ? playlist[index] ?? null : null),
};

/** The tracks the settings ask for: the player's links and songs, or the game's song when there are none. */
export function tracksFor(s: Pick<UiSettings, 'musicSource' | 'musicLinks'> & { musicSong?: string }, songs: MySong[]): Track[] {
  if (s.musicSource !== 'mine') {
    // "all": every song that comes with the game, one after another
    if (s.musicSong === 'all') return SONGS.map(x => ({ type: 'default' as const, song: x.id }));
    return [s.musicSong && s.musicSong !== SONGS[0]!.id ? { type: 'default', song: songById(s.musicSong).id } : { type: 'default' }];
  }
  const mine: Track[] = [
    ...s.musicLinks.map(parseMusicLink).filter((t): t is Track => !!t),
    ...songs.map(x => ({ type: 'file' as const, id: x.id, blob: x.blob })),
  ];
  return mine.length ? mine : [{ type: 'default' }];
}

/** Changes when what's playing might have changed, for screens that show it. */
export const nowPlaying = createStore(0);

let started = false;

/**
 * Keeps the music in step with the settings: on or off, which songs, how loud. Browsers only allow sound
 * after the player taps or presses a key, so the music starts then. Safe to call many times.
 */
export function startMusic(): void {
  if (started || !hasDOM) return;
  started = true;
  let unlocked = false;
  const sync = () => {
    const s = settings.get();
    music.setVolume(s.musicVolume);
    if (!s.music || !unlocked) music.stop();
    else music.setTracks(tracksFor(s, mySongs.get()));
    nowPlaying.set(nowPlaying.get() + 1);
  };
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    sync();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  settings.subscribe(sync);
  mySongs.subscribe(sync);
  void loadMySongs();
}
