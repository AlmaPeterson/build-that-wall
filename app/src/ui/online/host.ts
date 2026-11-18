// The host's device runs the real game. After every change it sends each online player their own
// view (viewFor: only their hand) and the events they may see (redactEvent), on that player's own topic.
// Remote players' decisions go to their device through the room's ask/answer; their actions come back here.
// A device can have more than one person playing on it (guests): their seats share its room seat, and
// that device passes itself between them like Pass'n'Play. The host's own guests play on this device.
import { redactEvent, viewFor, type Action, type ActionResult, type Answer, type BotMemory, type Decider, type Decision, type GameSettings, type GameState, type Seat } from '../../game';
import type { OnlineRoom } from '../../services/online';
import { GameController, waitingOn, type Waiting } from '../controller';
import { ASK_MODE, TURN_OK, parseAnswer, type ToHost, type ToPlayer } from './messages';

const SEND_DELAY_MS = 40;      // gather a burst of changes (a bot's turn) into one snapshot

export class HostController extends GameController {
  /** Room seat (1 = host, 2-6 players) of each human game seat; bots come after them. Guests share their device's room seat. */
  private readonly roomSeats: number[];
  private sentEvents = new Map<Seat, number>();
  private sentView = new Map<Seat, string>();
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  /** A question asked of a remote player that they haven't answered yet. */
  private remoteWaiting: Waiting | null = null;
  /** Stops waiting for a remote player's OK on the turn banner, if that's what the game is waiting for. */
  private stopTurnOk: ((seat: Seat) => void) | null = null;
  /** Stops waiting for a remote player's answer (a bot took over their seat): the safe fallback answer is used. */
  private stopAsk = new Map<Seat, () => void>();

  constructor(private readonly room: Pick<OnlineRoom, 'sendData' | 'ask'>, roomSeats: number[], memory?: BotMemory, turnBanner = false) {
    super({
      passScreen: true, memory, turnBanner,
      localSeats: roomSeats.flatMap((r, seat) => (r === 1 ? [seat] : [])),
      remoteDecider: seat => ((roomSeats[seat] ?? 1) !== 1 ? this.remote(seat) : null),
    });
    this.roomSeats = roomSeats;
    this.snapshot.subscribe(() => this.scheduleSend());
  }

  /** Start the game; game seat i is the player in room seat roomSeats[i]. */
  override start(settings: GameSettings, seed?: number): Promise<void> {
    this.sentEvents.clear(); this.sentView.clear();
    return super.start(settings, seed);
  }

  /** The host's own board can only act on the turn of someone playing on this device. */
  override act(action: Action): Promise<ActionResult> {
    if (this.state && this.roomSeats[this.state.turn] !== 1) return Promise.resolve({ ok: false, reason: "It isn't your turn." });
    return super.act(action);
  }

  /** A player left while the game waited for their OK: it goes on without them straight away. */
  override leave(seat: Seat): Promise<void> {
    const left = super.leave(seat);
    this.stopTurnOk?.(seat);
    return left;
  }

  /** A player left the game: a bot plays their cards from now on. */
  playerLeft(seat: Seat): Promise<void> {
    return this.botFor(seat, this.nameOf(seat) + ' left the game, so a bot is playing for them.');
  }

  override canHandToBot(seat: Seat): boolean {
    const s = this.state;
    return !!s && !s.over && (this.roomSeats[seat] ?? 1) !== 1 && !!s.seats[seat] && !s.seats[seat]!.bot && !s.seats[seat]!.left;
  }

  /** The host lets a bot play for someone who isn't playing (away, stuck, or gone without saying so). */
  override handToBot(seat: Seat): void {
    if (!this.canHandToBot(seat)) return;
    void this.botFor(seat, 'The host let a bot play for ' + this.nameOf(seat) + '.');
  }

  /** A player who left came back (a new page on their device): they play their seat again. */
  playerBack(seat: Seat): void {
    if (this.state?.seats[seat]?.standIn) this.takeBack(seat, this.nameOf(seat) + ' is back and playing again.');
    this.resyncSeat(seat);
  }

  /** Their device asked for the seat back (they're still connected and a bot has been playing it). */
  private seatBack(seat: Seat): void {
    if (!this.state?.seats[seat]?.standIn) return;
    this.takeBack(seat, this.nameOf(seat) + ' is back and playing again.');
  }

  private async botFor(seat: Seat, text: string): Promise<void> {
    if (!this.canHandToBot(seat)) return;
    const done = this.standIn(seat, text);
    // Anything the game was waiting on them for is answered now, so the game goes on
    this.stopTurnOk?.(seat);
    this.stopAsk.get(seat)?.();
    await done;
  }

  private nameOf(seat: Seat): string { return this.state?.seats[seat]?.name ?? 'Player ' + (seat + 1); }

  /** The game seats played on this device: the host and their guests. */
  get hostSeats(): Seat[] { return this.roomSeats.flatMap((r, seat) => (r === 1 ? [seat] : [])); }

  /** The game seats played on another device (its room seat): its player and their guests. None for the host or a stranger. */
  gameSeats(roomSeat: number): Seat[] {
    return roomSeat === 1 ? [] : this.roomSeats.flatMap((r, seat) => (r === roomSeat ? [seat] : []));
  }

  /** A message from an online device. */
  receive(msg: ToHost, fromRoomSeat: number): void {
    const seats = this.gameSeats(fromRoomSeat);
    if (!seats.length) return;
    if (msg.k === 'playAgain') { for (const seat of seats) this.seatBack(seat); return; }
    if (msg.k === 'resync') {
      for (const seat of seats) { this.sentEvents.set(seat, 0); this.sentView.delete(seat); }
      this.sendNow();
      return;
    }
    if (msg.k === 'act') {
      const reply = (result: ActionResult) => this.room.sendData(fromRoomSeat, { k: 'result', id: msg.id, result } satisfies ToPlayer);
      const turn = this.state?.turn ?? -1;
      if (!seats.includes(turn) || (msg.seat !== undefined && msg.seat !== turn)) { reply({ ok: false, reason: "It isn't your turn." }); return; }
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
    for (let seat = 0; seat < this.roomSeats.length; seat++) {
      if (this.roomSeats[seat] === 1 || s.seats[seat]?.left) continue;
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
    const asked = this.room.ask(this.roomSeats[seat]!, { l1: JSON.stringify({ kind: TURN_OK, seat }), l2: '', l3: '', card: 0, mode: ASK_MODE });
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
          const asked = this.room.ask(this.roomSeats[seat]!, { l1: JSON.stringify(d), l2: '', l3: '', card: 'card' in d ? d.card : 0, mode: ASK_MODE });
          const stopped = new Promise<string>(stop => { this.stopAsk.set(seat, () => stop('')); });
          const value = await Promise.race([asked, stopped]);
          return back(parseAnswer(d, value));
        } finally {
          this.stopAsk.delete(seat);
          this.remoteWaiting = null;
          this.refresh();
        }
      },
    };
  }
}
