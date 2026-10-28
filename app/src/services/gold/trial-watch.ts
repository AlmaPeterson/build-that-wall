import type { SaveStore } from '../storage';
import type { Entitlements } from './entitlements';

export interface TrialWatchHooks {
  isGameRunning(): boolean;                 // wait until the game is over
  showCountdown(text: string): void;        // small gold toast
  showEnded(): void;                        // the big "Your free trial has ended" notice
  onEnded?(): void;                         // live only: reload cosmetics (was the "Load Cosmetics" broadcast)
}

// Counts the trial down once a day, and ends it properly when the 7 days are up
export class TrialWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly store: SaveStore, private readonly ent: Entitlements, private readonly hooks: TrialWatchHooks,
    private readonly now: () => number = Date.now) {}

  // Every 30 seconds, plus once shortly after starting (same timing as before)
  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(true), 30000);
    setTimeout(() => this.tick(false), 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(live: boolean): void {
    const rec = this.ent.trialRecord();
    if (!rec || !rec.exp || this.ent.isOwner || this.ent.testGold) return;
    if (this.hooks.isGameRunning()) return;
    if (rec.exp * 1000 > this.now()) {
      const left = this.ent.daysLeft(rec.exp), key = rec.exp + ':' + left;
      if (this.store.get('trialDay') === key) return;
      this.store.set('trialDay', key);
      this.hooks.showCountdown('Gold free trial: ' + left + (left === 1 ? ' day' : ' days') + ' left');
      return;
    }
    if (this.ent.goldActive() || this.store.get('trialEnd') === String(rec.exp)) return;
    this.store.set('trialEnd', String(rec.exp));
    this.hooks.showEnded();
    if (live) try { this.hooks.onEnded?.(); } catch { /* ignore */ }
  }
}
