// Runs a game for the screens. The board reads `view` (what the viewing player may see), `events`
// and `prompt` (a question the engine is waiting on); it answers prompts with `answer` and acts with `act`.
//
// Online play (ui/online) plugs in by giving a different `humanDecider`/`startGame`; the board doesn't care.
import {
  createLocalGame, redactEvent, viewFor, type Action, type ActionResult, type Answer, type BotMemory, type Decider, type Decision,
  type Game, type GameEvent, type GameSettings, type GameState, type Seat,
} from '../game';
import { createStore, type Store } from './store';

/** A question for a human player, waiting for the UI to answer. */
export interface Prompt<D extends Decision = Decision> {
  decision: D;
  answer(value: Answer<D>): void;
}

export interface GameSnapshot {
  /** What `viewer` may see (other hands hidden). null before a game starts. */
  view: GameState | null;
  /** The seat whose hand is on screen (Pass'n'Play: the current human; online: this device's seat). */
  viewer: Seat;
  /** Everything that happened this game, oldest first. */
  events: GameEvent[];
  /** The question the engine is waiting on, if it's for a human on this device. */
  prompt: Prompt | null;
  /** The pass-the-device screen is up, waiting for this seat to tap "I'm ready". */
  passTo: Seat | null;
}

export interface ControllerOptions {
  memory?: BotMemory;
  learn?: boolean;
  /** Pass'n'Play with 2+ humans: show the pass-the-device screen before each human turn. */
  passScreen?: boolean;
  /**
   * Online host: the only seat shown on this device. Its hand is the one on screen, and other players'
   * drawn cards are hidden in `events`. Default: every human seat on this device (Pass'n'Play).
   */
  localSeat?: Seat;
  /** Online host: who answers for a human seat that isn't on this device. null = ask on this device. */
  remoteDecider?: (seat: Seat) => Decider | null;
  /** Pause before each bot action (ms) so people can follow it; watch mode uses `watchDelay`. Default 0 (tests). */
  botDelay?: number;
  watchDelay?: number;
}

const forever = new Promise<never>(() => {});

export class GameController {
  readonly snapshot: Store<GameSnapshot> = createStore<GameSnapshot>({ view: null, viewer: 0, events: [], prompt: null, passTo: null });
  private game: Game | null = null;
  private events: GameEvent[] = [];
  private prompts: Prompt[] = [];
  private passResolve: (() => void) | null = null;
  private passSeat: Seat | null = null;
  /** Pass'n'Play: the human holding the device now (the last one who tapped "I'm ready"). */
  private holder: Seat | null = null;
  private stopped = false;
  private pace: (() => Promise<void>) | null = null;

  constructor(private readonly opts: ControllerOptions = {}) {}

  get state(): Readonly<GameState> | null { return this.game?.state ?? null; }

  /** Every event this game, unredacted (the online host redacts them per player). */
  get allEvents(): readonly GameEvent[] { return this.events; }

  /** Start a game on this device. Resolves when the game is over (or the first human decision is needed and so on). */
  start(settings: GameSettings, seed = Math.floor(Math.random() * 2 ** 31)): Promise<void> {
    this.events = [];
    this.prompts = [];
    this.holder = null;
    this.stopped = false;
    const humans = settings.players - settings.bots;
    const delay = humans === 0 ? this.opts.watchDelay ?? 0 : this.opts.botDelay ?? 0;
    this.game = createLocalGame({
      settings, seed, memory: this.opts.memory, learn: this.opts.learn,
      humanDecider: seat => this.opts.remoteDecider?.(seat) ?? { decide: d => this.ask(d) },
      emit: e => { if (!this.stopped) { this.events.push(e); this.publish(); } },
      beforeTurn: this.passing() ? seat => this.passTo(seat) : undefined,
      beforeBotAction: async () => {
        // Let the board finish showing what just happened, then pause so people can follow
        if (this.pace) await this.pace();
        if (this.stopped) return forever;
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      },
    });
    this.publish();
    return this.game.start();
  }

  /** The viewing player takes an action on their turn. */
  act(action: Action): Promise<ActionResult> {
    if (!this.game) return Promise.resolve({ ok: false, reason: 'No game.' });
    return this.game.act(this.game.state.turn, action).finally(() => {
      this.publish();
      // Someone else answered a question during this turn: pass the device back before the turn goes on
      const s = this.game?.state;
      if (s && !s.over && this.passing() && !s.seats[s.turn]?.bot && this.holder !== s.turn && !this.passResolve) void this.passTo(s.turn);
    });
  }

  /** End the game now (End Game, leaving the board): nothing more happens and nothing more is published. */
  stop(): void {
    this.stopped = true;
    this.prompts = [];
    this.passResolve = null;
  }

  /** Bots wait for this before each action: the board's animator, so the game never runs ahead of what's shown. */
  setPace(pace: (() => Promise<void>) | null): void { this.pace = pace; }

  /** The engine's read-only questions (canPlay, buildOptions, ...) for the board's menus. */
  get api(): Game | null { return this.game; }

  /** The player on the pass-the-device screen is ready. */
  ready(): void {
    const r = this.passResolve;
    this.passResolve = null;
    if (this.passSeat !== null) this.holder = this.passSeat;
    this.passSeat = null;
    this.publish();
    r?.();
  }

  /** Publish the snapshot again (e.g. after a test changed the state directly). */
  refresh(): void { this.publish(); }

  async leave(seat: Seat): Promise<void> { await this.game?.leave(seat); this.publish(); }

  /** Pass'n'Play with 2+ humans on this device: the device is handed between them. */
  private passing(): boolean {
    const s = this.game?.state;
    if (!s || this.opts.passScreen === false || this.opts.localSeat !== undefined) return false;
    return s.seats.filter((x, i) => !x.bot && !this.opts.remoteDecider?.(i)).length >= 2;
  }

  private async ask<D extends Decision>(decision: D): Promise<Answer<D>> {
    // Someone other than the player holding the device must answer: hand it to them first
    if (this.passing() && this.holder !== decision.seat) await this.passTo(decision.seat);
    if (this.stopped) return forever;
    return new Promise(resolve => {
      const prompt: Prompt<D> = {
        decision,
        answer: value => {
          this.prompts = this.prompts.filter(p => p !== prompt);
          this.publish();
          resolve(value);
        },
      };
      this.prompts.push(prompt as unknown as Prompt);
      this.publish();
    });
  }

  private passTo(seat: Seat): Promise<void> {
    if (this.stopped) return forever;
    return new Promise(resolve => { this.passResolve = resolve; this.passSeat = seat; this.publish(seat); });
  }

  /** The seat whose hand is shown: whoever is being asked something, else the current human, else the last one shown. */
  private viewer(): Seat {
    const s = this.game?.state;
    if (this.opts.localSeat !== undefined) return this.opts.localSeat;
    if (!s) return 0;
    const asked = this.prompts[0]?.decision.seat;
    if (asked !== undefined) return asked;
    if (this.holder !== null && this.passing()) return this.holder;
    if (s.turn >= 0 && !s.seats[s.turn]?.bot) return s.turn;
    const prev = this.snapshot.get().viewer;
    return s.seats[prev] && !s.seats[prev]!.bot ? prev : Math.max(0, s.seats.findIndex(x => !x.bot));
  }

  private publish(passTo: Seat | null = this.passResolve ? this.snapshot.get().passTo : null): void {
    const s = this.game?.state ?? null;
    const viewer = passTo ?? this.viewer();
    this.snapshot.set({
      view: s ? viewFor(s, viewer) : null,
      viewer,
      // Other players' drawn cards stay hidden, on a shared device too
      events: this.events.map(e => redactEvent(e, viewer)),
      prompt: passTo === null ? this.prompts[0] ?? null : null,
      passTo,
    });
  }
}
