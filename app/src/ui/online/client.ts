// An online player's device: it doesn't run the game. It shows the snapshots the host sends
// (only this player's own hand is in them), answers the host's questions and sends actions to the host.
// It looks like any other GameController to the board.
//
// More than one person can play on this device (guests). The host sends each of their seats its own
// snapshot, and the device is passed between them like Pass'n'Play: a hand is only shown to its player.
import { Game, type Action, type ActionResult, type Answer, type Decision, type GameEvent, type GameState, type Seat } from '../../game';
import { cardRules } from '../../game/effects';
import { GameController, type Prompt, type Waiting } from '../controller';
import type { ToHost, ToPlayer } from './messages';

const ACT_TIMEOUT_MS = 60000;

export class OnlineClientController extends GameController {
  /** Each seat played on this device: what it may see, and the events it was sent. */
  private views = new Map<Seat, GameState>();
  private received = new Map<Seat, GameEvent[]>();
  private readers = new Map<Seat, Game>();
  /** This device's seats, in the order the host first sent them (its player first). */
  private mine: Seat[] = [];
  private pending: Prompt[] = [];
  private actId = 0;
  private results = new Map<number, (r: ActionResult) => void>();
  private waitingFor: Waiting | null = null;
  private turnOkSeat: Seat | null = null;
  private turnOkDone: (() => void) | null = null;
  /** Who is holding the device now (the last one who tapped "I'm ready"); with one person it's always them. */
  private handedTo: Seat | null = null;

  /** send: a message to the host. */
  constructor(private readonly send: (msg: ToHost) => void) {
    super({ passScreen: false });
  }

  /** The seat on screen now. */
  private get viewerSeat(): Seat { return this.shown().viewer; }

  override get state(): Readonly<GameState> | null { return this.views.get(this.viewerSeat) ?? null; }
  override get allEvents(): readonly GameEvent[] { return this.received.get(this.viewerSeat) ?? []; }

  /** canPlay, buildOptions and the other questions, answered from the view on screen. */
  override get api(): Game | null { return this.readers.get(this.viewerSeat) ?? null; }

  override start(): Promise<void> { return Promise.reject(new Error('An online player does not start the game; the host does.')); }

  override act(action: Action): Promise<ActionResult> {
    const view = this.state, seat = view?.turn ?? -1;
    if (!view) return Promise.resolve({ ok: false, reason: 'No game.' });
    if (!this.mine.includes(seat) || this.shown().passTo !== null || this.viewerSeat !== seat) return Promise.resolve({ ok: false, reason: "It isn't your turn." });
    const id = ++this.actId;
    return new Promise(res => {
      this.results.set(id, res);
      this.send({ k: 'act', id, action, seat });
      // The turn moved on: it worked, and the host is only waiting for the next player to tap OK on their turn banner
      setTimeout(() => { if (this.results.delete(id)) res(this.state?.turn === seat ? { ok: false, reason: 'The host did not answer.' } : { ok: true }); }, ACT_TIMEOUT_MS);
    });
  }

  override canPlayAgain(): boolean {
    const v = this.state;
    return !!v && !v.over && this.mine.some(seat => !!v.seats[seat]?.standIn);
  }
  override playAgain(): void { if (this.canPlayAgain()) this.send({ k: 'playAgain' }); }

  /** The person on the pass-the-device screen is ready. */
  override ready(): void {
    const to = this.shown().passTo;
    if (to === null) return;
    this.handedTo = to;
    this.publishView();
  }
  override async leave(): Promise<void> {}

  /** A message from the host. */
  receive(msg: ToPlayer): void {
    if (msg.k === 'result') {
      const done = this.results.get(msg.id);
      this.results.delete(msg.id);
      done?.(msg.result);
      return;
    }
    if (msg.k !== 'snap') return;
    const seat = msg.seat;
    if (!this.mine.includes(seat)) this.mine.push(seat);
    this.views.set(seat, msg.view);
    this.waitingFor = msg.waiting ?? null;
    this.readers.set(seat, new Game(msg.view, {
      rules: cardRules,
      deciderFor: () => ({ decide: () => Promise.reject(new Error('read only')) }),
      bot: { nextAction: () => ({ type: 'endTurn' }) },
    }));
    const had = this.received.get(seat) ?? [];
    if (msg.from === had.length) this.received.set(seat, had.concat(msg.events));
    else if (msg.from === 0) this.received.set(seat, msg.events.slice());
    else this.send({ k: 'resync' });            // missed some events: ask for the whole list again
    // The host stopped waiting for OK (too long) and drew the cards: the banner has nothing left to wait for
    if (this.turnOkDone && this.turnOkSeat === seat && msg.events.some(e => e.type === 'draw' && e.seat === seat)) this.turnOk();
    this.publishView();
  }

  /** The host asks someone on this device something. Resolves when they answer on the board. */
  askHere<D extends Decision>(decision: D): Promise<Answer<D>> {
    return new Promise(resolve => {
      const prompt: Prompt<D> = {
        decision,
        answer: value => {
          this.pending = this.pending.filter(p => p !== prompt);
          this.publishView();
          resolve(value);
        },
      };
      this.pending.push(prompt as unknown as Prompt);
      this.publishView();
    });
  }

  /** It's the turn of a seat on this device: show its banner. Resolves when its player taps OK. */
  askTurnOk(seat: Seat = this.mine[0] ?? 0): Promise<void> {
    return new Promise(resolve => { this.turnOkSeat = seat; this.turnOkDone = resolve; this.publishView(); });
  }

  override turnOk(): void {
    const done = this.turnOkDone;
    this.turnOkDone = null;
    this.turnOkSeat = null;
    this.publishView();
    done?.();
  }

  /** This device's first seat (its own player). */
  get seat(): Seat { return this.mine[0] ?? 0; }
  /** Every seat played on this device. */
  get seats(): Seat[] { return [...this.mine]; }

  /** Who is on screen and whether the device must be passed to them first. */
  private shown(): { viewer: Seat; passTo: Seat | null } {
    const first = this.mine[0] ?? 0;
    if (this.mine.length < 2) return { viewer: first, passTo: null };
    const turn = this.views.get(first)?.turn ?? -1;
    // Whoever must act now: someone being asked, then the turn banner's player, then whose turn it is
    const asked = this.pending[0]?.decision.seat ?? this.turnOkSeat ?? (this.mine.includes(turn) ? turn : null);
    if (asked === null) return { viewer: this.handedTo ?? first, passTo: null };
    return asked === this.handedTo ? { viewer: asked, passTo: null } : { viewer: asked, passTo: asked };
  }

  private publishView(): void {
    const { viewer, passTo } = this.shown();
    this.snapshot.set({
      view: this.views.get(viewer) ?? null, viewer, events: (this.received.get(viewer) ?? []).slice(),
      prompt: passTo === null ? this.pending.find(p => p.decision.seat === viewer) ?? null : null,
      passTo,
      turnBanner: this.turnOkDone && this.turnOkSeat === viewer ? viewer : null,
      sharedDevice: this.mine.length >= 2,
      waitingFor: this.waitingFor,
    });
  }
}
