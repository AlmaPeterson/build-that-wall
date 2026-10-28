// Sound effects and background music. Sound effects follow the Sound Effects setting; music is a
// playlist of YouTube links and the player's own song files (Cycle All / Play One), as in the old game.
import { settings } from './app-state';
import { sound } from './assets';

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

// ---- background music

type Track = { type: 'yt'; id: string } | { type: 'file'; url: string; name: string };

const hasDOM = typeof document !== 'undefined';
const playlist: Track[] = [];
let index = 0, volume = 0.6, playing = false, token = 0;
let audio: HTMLAudioElement | null = null, frame: HTMLIFrameElement | null = null;

export function youtubeId(url: string): string | null {
  const m = String(url).match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1]! : null;
}

const mode = () => settings.get().musicMode;

function clearPlayer(): void {
  token++;
  if (audio) { audio.onended = null; audio.pause(); audio = null; }
  if (frame) { frame.remove(); frame = null; }
}

function trackEnded(myToken: number): void {
  if (myToken !== token || !playing) return;
  if (mode() === 'cycle') index = (index + 1) % playlist.length;
  playCurrent();
}

function playCurrent(): void {
  clearPlayer();
  if (!hasDOM || playlist.length === 0) { playing = false; return; }
  playing = true;
  index = ((index % playlist.length) + playlist.length) % playlist.length;
  const track = playlist[index]!;
  const myToken = token;
  if (track.type === 'file') {
    audio = new Audio(track.url);
    audio.volume = volume;
    audio.onended = () => trackEnded(myToken);
    audio.play().catch(() => {});
    return;
  }
  // A hidden YouTube player; it tells us when the video ends so the next song can start
  const origin = encodeURIComponent(location.origin);
  const f = document.createElement('iframe');
  f.src = `https://www.youtube-nocookie.com/embed/${track.id}?autoplay=1&enablejsapi=1&origin=${origin}`;
  f.allow = 'autoplay; encrypted-media';
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;';
  f.onload = () => {
    const w = f.contentWindow;
    if (!w) return;
    w.postMessage(JSON.stringify({ event: 'listening', id: myToken, channel: 'widget' }), '*');
    w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: myToken, channel: 'widget' }), '*');
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
    if (state === 0) trackEnded(token);                                  // video finished
    if (data.event === 'onError') setTimeout(() => trackEnded(token), 1000);   // can't embed: skip
  });
}

export const music = {
  isValidYouTube: (url: string) => youtubeId(url) !== null,
  /** Add a YouTube link; false if it isn't one. */
  addYouTube(url: string): boolean {
    const id = youtubeId(url);
    if (id) playlist.push({ type: 'yt', id });
    return !!id;
  },
  /** Ask the player for song files from their device and add them. */
  addFiles(): Promise<void> {
    if (!hasDOM) return Promise.resolve();
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'audio/*'; input.multiple = true;
      input.onchange = () => {
        for (const f of Array.from(input.files ?? [])) playlist.push({ type: 'file', url: URL.createObjectURL(f), name: f.name });
        resolve();
      };
      input.addEventListener('cancel', () => resolve());
      input.click();
    });
  },
  clear(): void {
    music.stop();
    for (const t of playlist) if (t.type === 'file') URL.revokeObjectURL(t.url);
    playlist.length = 0; index = 0;
  },
  play(): void { if (playlist.length) playCurrent(); },
  next(): void { if (!playlist.length) return; index = (index + 1) % playlist.length; playCurrent(); },
  stop(): void { playing = false; clearPlayer(); },
  /** Song files only (YouTube has its own volume). 0-100. */
  setVolume(percent: number): void { volume = Math.max(0, Math.min(1, percent / 100 || 0)); if (audio) audio.volume = volume; },
  count: () => playlist.length,
  number: () => (playlist.length ? index + 1 : 0),
  isPlaying: () => playing,
};
