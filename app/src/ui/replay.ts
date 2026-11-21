// Game replay (Gold): every game shown on this device is recorded as it goes, one picture of the board at
// the start of each turn, plus the events. The last finished game is kept in "btw:replay" and can be
// watched again turn by turn. The replay shows the board the way the online player's screen does: it is
// fed one recorded snapshot after another, so cards fly between them as they did in the game.
import type { GameEvent, GameState, Seat } from '../game';
import { browserStorage, SaveStore } from '../services/storage';
import { controller, screen } from './app-state';
import type { GameController } from './controller';
import { OnlineClientController } from './online/client';
import { createStore, type Store } from './store';

export interface ReplayFrame { view: GameState; n: number }   // n: how many events had happened
export interface Replay { v: 1; viewer: Seat; frames: ReplayFrame[]; events: GameEvent[]; savedAt: number }

const KEY = 'replay';
/** Bigger replays (very long games) keep fewer pictures so they still fit in the browser's storage. */
const MAX_CHARS = 1_500_000;

const store = () => new SaveStore(browserStorage());

/** True while a finished game is waiting to be watched again (for the buttons that start it). */
export const hasReplay = createStore<boolean>(false);

export function loadReplay(s: SaveStore = store()): Replay | null {
  const r = s.getJson<Replay | null>(KEY, null);
  return r && r.v === 1 && Array.isArray(r.frames) && r.frames.length > 1 && Array.isArray(r.events) ? r : null;
}

/** Keep every other picture until the replay fits. The first and last stay. */
export function shrink(r: Replay, max = MAX_CHARS): Replay | null {
  let frames = r.frames;
  for (let i = 0; i < 8; i++) {
    if (JSON.stringify({ ...r, frames }).length <= max) return { ...r, frames };
    if (frames.length <= 2) return null;
    frames = frames.filter((_, k) => k % 2 === 0 || k === frames.length - 1);
  }
  return null;
}

/** Record what `c` shows: a picture at each new turn, and the last one when the game ends. */
export function recordGame(c: GameController, viewer: () => Seat, s: SaveStore = store()): () => void {
  const frames: ReplayFrame[] = [];
  let seen = 0, saved = false;
  return c.snapshot.subscribe(() => {
    const state = c.state, events = c.allEvents;
    if (!state || saved || events.length === seen) return;
    const fresh = events.slice(seen);
    seen = events.length;
    if (!fresh.some(e => e.type === 'turnStart' || e.type === 'gameOver')) return;
    frames.push({ view: structuredClone(state) as GameState, n: events.length });
    if (state.over) {
      saved = true;
      const r = shrink({ v: 1, viewer: viewer(), frames, events: [...events], savedAt: Date.now() });
      if (r) { s.setJson(KEY, r); hasReplay.set(true); }
    }
  });
}

/** Plays a recorded game back: one frame at a time, by hand or on its own. */
export class ReplayController extends OnlineClientController {
  readonly at: Store<{ frame: number; playing: boolean }> = createStore({ frame: -1, playing: false });
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly rec: Replay) {
    super(() => {});
    this.replay = true;
  }

  get frames(): number { return this.rec.frames.length; }

  /** Show frame `i` (from the one before it, the cards move; from anywhere else, the board just changes). */
  goto(i: number): void {
    const f = this.rec.frames[Math.max(0, Math.min(this.frames - 1, i))]!;
    const k = this.rec.frames.indexOf(f), cur = this.at.get().frame;
    const prev = k === cur + 1 && cur >= 0 ? this.rec.frames[cur]!.n : 0;
    this.receive({ k: 'snap', seat: this.rec.viewer, view: structuredClone(f.view), events: this.rec.events.slice(prev, f.n), from: prev, total: f.n });
    this.at.set({ ...this.at.get(), frame: k });
    if (k >= this.frames - 1) this.pause();
  }

  next(): void { this.goto(this.at.get().frame + 1); }
  back(): void { this.goto(this.at.get().frame - 1); }

  play(ms = 1800): void {
    if (this.timer) return;
    if (this.at.get().frame >= this.frames - 1) this.goto(0);
    this.at.set({ ...this.at.get(), playing: true });
    this.timer = setInterval(() => this.next(), ms);
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.at.set({ ...this.at.get(), playing: false });
  }

  override stop(): void { this.pause(); super.stop(); }
}

/** Watch the last finished game again. */
export function startReplay(): boolean {
  const r = loadReplay();
  if (!r) return false;
  controller.get()?.stop();
  const c = new ReplayController(r);
  controller.set(c);
  screen.set('game');
  c.goto(0);
  return true;
}

/** Leave the replay. */
export function endReplay(): void {
  controller.get()?.stop();
  controller.set(null);
  screen.set('menu');
}

if (typeof window !== 'undefined') hasReplay.set(!!loadReplay());

// Record every game shown on this device (not replays), so the last one can be watched again
if (typeof window !== 'undefined') {
  let stopRecording: (() => void) | null = null;
  controller.subscribe(c => {
    stopRecording?.();
    stopRecording = c && !c.replay ? recordGame(c, () => c.snapshot.get().viewer) : null;
  });
}
