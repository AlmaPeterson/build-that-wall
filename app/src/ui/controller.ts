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
}

export class GameController {
  readonly snapshot: Store<GameSnapshot> = createStore<GameSnapshot>({ view: null, viewer: 0, events: [], prompt: null, passTo: null });
  private game: Game | null = null;
  private events: GameEvent[] = [];
  private prompts: Prompt[] = [];
  private passResolve: (() => void) | null = null;

  constructor(private readonly opts: ControllerOptions = {}) {}

  get state(): Readonly<GameState> | null { return this.game?.state ?? null; }

  /** Every event this game, unredacted (the online host redacts them per player). */
  get allEvents(): readonly GameEvent[] { return this.events; }

  /** Start a game on this device. Resolves when the game is over (or the first human decision is needed and so on). */
  start(settings: GameSettings, seed = Math.floor(Math.random() * 2 ** 31)): Promise<void> {
    this.events = [];
    this.prompts = [];
    const humans = settings.players - settings.bots;
    this.game = createLocalGame({
      settings, seed, memory: this.opts.memory, learn: this.opts.learn,
      humanDecider: seat => this.opts.remoteDecider?.(seat) ?? { decide: d => this.ask(d) },
      emit: e => { this.events.push(e); this.publish(); },
      beforeTurn: this.opts.passScreen !== false && humans >= 2 ? seat => this.passTo(seat) : undefined,
    });
    this.publish();
    return this.game.start();
  }

  /** The viewing player takes an action on their turn. */
  act(action: Action): Promise<ActionResult> {
    if (!this.game) return Promise.resolve({ ok: false, reason: 'No game.' });
    return this.game.act(this.game.state.turn, action).finally(() => this.publish());
  }

  /** The engine's read-only questions (canPlay, buildOptions, ...) for the board's menus. */
  get api(): Game | null { return this.game; }

  /** The player on the pass-the-device screen is ready. */
  ready(): void {
    const r = this.passResolve;
    this.passResolve = null;
    this.publish();
    r?.();
  }

  async leave(seat: Seat): Promise<void> { await this.game?.leave(seat); this.publish(); }

  private ask<D extends Decision>(decision: D): Promise<Answer<D>> {
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
    return new Promise(resolve => { this.passResolve = resolve; this.publish(seat); });
  }

  /** The seat whose hand is shown: whoever is being asked something, else the current human, else the last one shown. */
  private viewer(): Seat {
    const s = this.game?.state;
    if (this.opts.localSeat !== undefined) return this.opts.localSeat;
    if (!s) return 0;
    const asked = this.prompts[0]?.decision.seat;
    if (asked !== undefined) return asked;
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
      events: this.opts.localSeat !== undefined ? this.events.map(e => redactEvent(e, viewer)) : this.events.slice(),
      prompt: passTo === null ? this.prompts[0] ?? null : null,
      passTo,
    });
  }
}
