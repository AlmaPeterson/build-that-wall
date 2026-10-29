// Runs a game for the screens. The board reads `view` (what the viewing player may see), `events`
// and `prompt` (a question the engine is waiting on); it answers prompts with `answer` and acts with `act`.
//
// Online play (ui/online) plugs in by giving a different `humanDecider`/`startGame`; the board doesn't care.
import {
  CARD_BACK, createLocalGame, redactEvent, viewFor, type Action, type ActionResult, type Answer, type BotMemory, type Decider, type Decision,
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
  /** "Player 1's turn" is showing for a moment before that player's turn starts (one person playing). */
  turnBanner?: Seat | null;
  /** This seat's turn was skipped (Quarantine): the game waits until they tap OK (skipSeen). */
  skipped?: Seat | null;
  /** Only bots are playing (a local game): every hand is face up, and the board shows the playing bot's. */
  openHands?: boolean;
  /** Pass'n'Play with 2+ people on this device: a hand is only shown to its player, never between turns. */
  sharedDevice?: boolean;
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
  /** One person on this device: show "<name>'s turn" this long (ms) before each of their turns. Default 0 (tests). */
  turnBanner?: number;
}

const forever = new Promise<never>(() => {});

const createdHooks: ((c: GameController) => void)[] = [];
/** Run `fn` for every controller as it's made, before its game starts (the board's animator must see the deal). */
export function onControllerCreated(fn: (c: GameController) => void): void { createdHooks.push(fn); }

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
  private bannerSeat: Seat | null = null;
  private skipResolve: (() => void) | null = null;
  private skipSeat: Seat | null = null;

  constructor(private readonly opts: ControllerOptions = {}) {
    for (const fn of createdHooks) fn(this);
  }

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
      // Checked at each turn: the game (and so who is human) only exists once createLocalGame returns
      beforeTurn: seat => (this.passing() ? this.passTo(seat) : this.banner(seat)),
      afterSkip: seat => this.waitForSkipOk(seat),
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
    this.skipResolve = null;
    this.skipSeat = null;
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

  /**
   * A "pick a card from your hand" question asked while that player's card is being played: the screen still
   * shows the played card in the hand (viewOf), so the question's slots are moved to match what's on screen,
   * and the answer moved back. Everything else is passed through as it is.
   */
  protected screenSlots<D extends Decision>(d: D): { decision: D; back(a: Answer<D>): Answer<D> } {
    const p = this.game?.unannouncedPlay;
    if (!p || d.kind !== 'chooseHandCard' || d.seat !== p.seat) return { decision: d, back: a => a };
    const at = p.slot;
    return {
      decision: { ...d, options: d.options.map(s => (s >= at ? s + 1 : s)) },
      back: a => (typeof a === 'number' && a > at ? a - 1 : a) as Answer<D>,
    };
  }

  private async ask<D extends Decision>(asked: D): Promise<Answer<D>> {
    // Someone other than the player holding the device must answer: hand it to them first
    if (this.passing() && this.holder !== asked.seat) await this.passTo(asked.seat);
    if (this.stopped) return forever;
    const { decision, back } = this.screenSlots(asked);
    return new Promise(resolve => {
      const prompt: Prompt<D> = {
        decision,
        answer: value => {
          this.prompts = this.prompts.filter(p => p !== prompt);
          this.publish();
          resolve(back(value));
        },
      };
      this.prompts.push(prompt as unknown as Prompt);
      this.publish();
    });
  }

  /** "<name>'s turn" for a moment, once the board has shown everything before it. */
  private async banner(seat: Seat): Promise<void> {
    const ms = this.opts.turnBanner ?? 0, s = this.game?.state;
    if (ms <= 0 || !s || s.seats[seat]?.bot || this.opts.localSeat !== undefined || this.opts.remoteDecider?.(seat)) return;
    if (this.pace) await this.pace();
    if (this.stopped) return forever;
    this.bannerSeat = seat;
    this.publish();
    await new Promise(r => setTimeout(r, ms));
    this.bannerSeat = null;
    if (this.stopped) return forever;
    this.publish();
  }

  /** The quarantined player tapped OK: the game goes on to the next turn. */
  skipSeen(): void {
    const r = this.skipResolve;
    this.skipResolve = null;
    this.skipSeat = null;
    this.publish();
    r?.();
  }

  /** A human on this device was quarantined: hold the game until they've seen it, so it doesn't run on behind the notice. */
  private async waitForSkipOk(seat: Seat): Promise<void> {
    if (this.opts.remoteDecider?.(seat) || (this.opts.localSeat !== undefined && this.opts.localSeat !== seat)) return;
    if (this.pace) await this.pace();
    if (this.stopped) return forever;
    await new Promise<void>(resolve => { this.skipResolve = resolve; this.skipSeat = seat; this.publish(); });
    if (this.stopped) return forever;
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

  /**
   * What `seat` may see: other hands hidden, and a card that's being played but not announced yet still where
   * it was (its player may still back out), so screens never show it vanish and come back.
   */
  viewOf(seat: Seat): GameState | null {
    const s = this.game?.state;
    if (!s) return null;
    const open = this.allBots();
    const v = viewFor(s, seat, open);
    const p = this.game!.unannouncedPlay;
    if (p) {
      if (p.discarded) v.discard.splice(v.discard.lastIndexOf(p.card), 1);
      v.seats[p.seat]?.hand.splice(p.slot, 0, open || seat === p.seat ? p.card : CARD_BACK);
    }
    return v;
  }

  /** A local game with only bots playing: nobody's hand is secret, so the watcher sees them all. */
  private allBots(): boolean {
    const s = this.game?.state;
    return !!s && this.opts.localSeat === undefined && s.seats.every(x => !!x.bot);
  }

  private publish(passTo: Seat | null = this.passResolve ? this.snapshot.get().passTo : null): void {
    const viewer = passTo ?? this.viewer();
    this.snapshot.set({
      view: this.viewOf(viewer),
      viewer,
      // Other players' drawn cards stay hidden, on a shared device too
      events: this.allBots() ? [...this.events] : this.events.map(e => redactEvent(e, viewer)),
      prompt: passTo === null ? this.prompts[0] ?? null : null,
      passTo,
      turnBanner: this.bannerSeat,
      skipped: this.skipSeat,
      openHands: this.allBots(),
      sharedDevice: this.passing(),
    });
  }
}
