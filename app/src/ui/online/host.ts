// The host's device runs the real game. After every change it sends each online player their own
// view (viewFor: only their hand) and the events they may see (redactEvent), on that player's own topic.
// Remote players' decisions go to their device through the room's ask/answer; their actions come back here.
import { redactEvent, viewFor, type Action, type ActionResult, type Answer, type BotMemory, type Decider, type Decision, type GameSettings, type GameState, type Seat } from '../../game';
import type { OnlineRoom } from '../../services/online';
import { GameController, waitingOn, type Waiting } from '../controller';
import { ASK_MODE, TURN_OK, parseAnswer, type ToHost, type ToPlayer } from './messages';

const SEND_DELAY_MS = 40;      // gather a burst of changes (a bot's turn) into one snapshot

export class HostController extends GameController {
  /** Room seat (1 = host, 2-6 players) of each human game seat; bots come after them. */
  private readonly roomSeats: number[];
  private sentEvents = new Map<Seat, number>();
  private sentView = new Map<Seat, string>();
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  /** A question asked of a remote player that they haven't answered yet. */
  private remoteWaiting: Waiting | null = null;
  /** Stops waiting for a remote player's OK on the turn banner, if that's what the game is waiting for. */
  private stopTurnOk: ((seat: Seat) => void) | null = null;

  constructor(private readonly room: Pick<OnlineRoom, 'sendData' | 'ask'>, roomSeats: number[], memory?: BotMemory, turnBanner = false) {
    super({
      passScreen: false, localSeat: 0, memory, turnBanner,
      remoteDecider: seat => (seat > 0 && seat < roomSeats.length ? this.remote(seat) : null),
    });
    this.roomSeats = roomSeats;
    this.snapshot.subscribe(() => this.scheduleSend());
  }

  /** Start the game; game seat i is the player in room seat roomSeats[i]. */
  override start(settings: GameSettings, seed?: number): Promise<void> {
    this.sentEvents.clear(); this.sentView.clear();
    return super.start(settings, seed);
  }

  /** The host's own board can only act on the host's own turn. */
  override act(action: Action): Promise<ActionResult> {
    if (this.state && this.state.turn !== 0) return Promise.resolve({ ok: false, reason: "It isn't your turn." });
    return super.act(action);
  }

  /** A player left while the game waited for their OK: it goes on without them straight away. */
  override leave(seat: Seat): Promise<void> {
    const left = super.leave(seat);
    this.stopTurnOk?.(seat);
    return left;
  }

  /** The game seat played from a room seat, or -1. */
  gameSeat(roomSeat: number): Seat { return this.roomSeats.indexOf(roomSeat); }

  /** A message from an online player. */
  receive(msg: ToHost, fromRoomSeat: number): void {
    const seat = this.gameSeat(fromRoomSeat);
    if (seat <= 0) return;
    if (msg.k === 'resync') {
      this.sentEvents.set(seat, 0); this.sentView.delete(seat);
      this.sendNow();
      return;
    }
    if (msg.k === 'act') {
      const reply = (result: ActionResult) => this.room.sendData(fromRoomSeat, { k: 'result', id: msg.id, result } satisfies ToPlayer);
      if (!this.state || this.state.turn !== seat) { reply({ ok: false, reason: "It isn't your turn." }); return; }
      void super.act(msg.action).then(reply, () => reply({ ok: false, reason: 'Something went wrong.' }));
    }
  }

  /** Send one online player everything again (they said "Still here" after missing things). */
  resyncSeat(seat: Seat): void {
    this.sentEvents.set(seat, 0); this.sentView.delete(seat);
    this.sendNow();
  }

  /** Send every online player everything again (after the host's connection dropped and came back). */
  resyncAll(): void {
    this.sentEvents.clear(); this.sentView.clear();
    this.sendNow();
  }

  /** Send every online player what changed, now. */
  sendNow(): void {
    if (this.sendTimer) { clearTimeout(this.sendTimer); this.sendTimer = null; }
    const s = this.state;
    if (!s) return;
    const all = this.allEvents;
    // Who everyone is waiting on: a remote player, or the host answering a question on this device
    const hostPrompt = this.snapshot.get().prompt;
    const banner = this.snapshot.get().turnBanner ?? null;
    const waiting = this.remoteWaiting ?? (hostPrompt ? waitingOn(hostPrompt.decision) : banner !== null ? { seat: banner, kind: TURN_OK } : null);
    for (let seat = 1; seat < this.roomSeats.length; seat++) {
      if (s.seats[seat]?.left) continue;
      const view = this.viewOf(seat) ?? viewFor(s as GameState, seat), js = JSON.stringify(view) + JSON.stringify(waiting);
      const from = this.sentEvents.get(seat) ?? 0;
      if (from === all.length && this.sentView.get(seat) === js) continue;
      const msg: ToPlayer = { k: 'snap', seat, view, events: all.slice(from).map(e => redactEvent(e, seat)), from, total: all.length, waiting };
      if (this.room.sendData(this.roomSeats[seat]!, msg)) { this.sentEvents.set(seat, all.length); this.sentView.set(seat, js); }
    }
  }

  private scheduleSend(): void {
    if (!this.sendTimer) this.sendTimer = setTimeout(() => this.sendNow(), SEND_DELAY_MS);
  }

  protected override waiting(): Waiting | null { return this.remoteWaiting; }

  /** Show the turn banner on their device. A timeout or a player who left gets the same result as OK. */
  protected override async remoteTurnOk(seat: Seat): Promise<void> {
    this.remoteWaiting = { seat, kind: TURN_OK };
    this.refresh();
    this.sendNow();
    const asked = this.room.ask(this.roomSeats[seat]!, { l1: JSON.stringify({ kind: TURN_OK }), l2: '', l3: '', card: 0, mode: ASK_MODE });
    try {
      await Promise.race([asked, new Promise<void>(stop => { this.stopTurnOk = s => { if (s === seat) stop(); }; })]);
    } finally {
      this.stopTurnOk = null;
      this.remoteWaiting = null;
      this.refresh();
    }
  }

  /** Ask a remote player's device; a timeout, a player who left or a bad answer gets the safe fallback. */
  private remote(seat: Seat): Decider {
    return {
      decide: async <D extends Decision>(asked: D): Promise<Answer<D>> => {
        const { decision: d, back } = this.screenSlots(asked);   // slots as their screen shows the hand
        this.remoteWaiting = waitingOn(asked);   // everyone else sees who they're waiting for
        this.refresh();
        this.sendNow();                     // they need the latest view to answer
        try {
          const value = await this.room.ask(this.roomSeats[seat]!, { l1: JSON.stringify(d), l2: '', l3: '', card: 'card' in d ? d.card : 0, mode: ASK_MODE });
          return back(parseAnswer(d, value));
        } finally {
          this.remoteWaiting = null;
          this.refresh();
        }
      },
    };
  }
}
