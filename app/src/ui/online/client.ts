// An online player's device: it doesn't run the game. It shows the snapshots the host sends
// (only this player's own hand is in them), answers the host's questions and sends actions to the host.
// It looks like any other GameController to the board.
import { Game, type Action, type ActionResult, type Answer, type Decision, type GameEvent, type GameState } from '../../game';
import { cardRules } from '../../game/effects';
import { GameController, type Prompt } from '../controller';
import type { ToHost, ToPlayer } from './messages';

const ACT_TIMEOUT_MS = 60000;

export class OnlineClientController extends GameController {
  private view: GameState | null = null;
  private reader: Game | null = null;
  private received: GameEvent[] = [];
  private seatNo = 0;
  private pending: Prompt[] = [];
  private actId = 0;
  private results = new Map<number, (r: ActionResult) => void>();

  /** send: a message to the host. */
  constructor(private readonly send: (msg: ToHost) => void) {
    super({ passScreen: false });
  }

  override get state(): Readonly<GameState> | null { return this.view; }
  override get allEvents(): readonly GameEvent[] { return this.received; }

  /** canPlay, buildOptions and the other questions, answered from this player's view. */
  override get api(): Game | null { return this.reader; }

  override start(): Promise<void> { return Promise.reject(new Error('An online player does not start the game; the host does.')); }

  override act(action: Action): Promise<ActionResult> {
    if (!this.view) return Promise.resolve({ ok: false, reason: 'No game.' });
    if (this.view.turn !== this.seatNo) return Promise.resolve({ ok: false, reason: "It isn't your turn." });
    const id = ++this.actId;
    return new Promise(res => {
      this.results.set(id, res);
      this.send({ k: 'act', id, action });
      setTimeout(() => { if (this.results.delete(id)) res({ ok: false, reason: 'The host did not answer.' }); }, ACT_TIMEOUT_MS);
    });
  }

  override ready(): void {}
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
    this.seatNo = msg.seat;
    this.view = msg.view;
    this.reader = new Game(msg.view, {
      rules: cardRules,
      deciderFor: () => ({ decide: () => Promise.reject(new Error('read only')) }),
      bot: { nextAction: () => ({ type: 'endTurn' }) },
    });
    if (msg.from === this.received.length) this.received = this.received.concat(msg.events);
    else if (msg.from === 0) this.received = msg.events.slice();
    else this.send({ k: 'resync' });            // missed some events: ask for the whole list again
    this.publishView();
  }

  /** The host asks this player something. Resolves when the player answers on the board. */
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

  get seat(): number { return this.seatNo; }

  private publishView(): void {
    this.snapshot.set({ view: this.view, viewer: this.seatNo, events: this.received.slice(), prompt: this.pending[0] ?? null, passTo: null });
  }
}
