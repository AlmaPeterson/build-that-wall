// Runs a game: dealing, turns, drawing, building, playing cards, final rounds and the end.
// Follows docs/game-rules.md sections 3-8 and 10; card effects come from CardRules (effects/),
// bot choices from BotPlayer (bots/), and every question goes to the asked seat's Decider.
import { isWall } from '../../data/cards';
import { actionCost, isImmediate } from '../cardinfo';
import type { BotPlayer, CardRules, EffectContext, GameApi } from '../contracts';
import { insertionShuffle, nextRandom, randomInt } from '../rng';
import type {
  Action, ActionResult, Answer, BuildPayment, CardId, Decider, Decision, Emit, GameEvent, GameState, Seat, WallRef,
} from '../types';
import * as board from './board';
import { cardName } from './board';

export interface GameOptions {
  rules: CardRules;
  deciderFor(seat: Seat): Decider;
  bot: BotPlayer;
  emit?: Emit;
  /** Called before a turn starts, e.g. to show the pass-the-device screen in Pass'n'Play. */
  beforeTurn?(seat: Seat): Promise<void>;
  /** Called before each bot action, e.g. to pace bots so people can follow what they do. */
  beforeBotAction?(seat: Seat): Promise<void>;
}

const MAN_HOUR = 14, SELF_DEFENSE = 20, TRUMP_TRAIN = 25, QUARANTINE = 17;
const IMMEDIATE_LIMIT = 21;      // `resolve immediates` repeats until its counter passes 20
const BOT_ACTION_LIMIT = 200;    // safety net: a bot turn never loops forever

export class Game implements GameApi {
  private busy = false;
  private readonly emitFn: Emit;

  constructor(public readonly state: GameState, private readonly opts: GameOptions) {
    this.emitFn = opts.emit ?? (() => {});
  }

  // ======== starting

  /** Deal 5 cards to every seat (one round at a time), then start the first turn. */
  async start(): Promise<void> {
    const s = this.state;
    this.emit({ type: 'gameStart', text: 'A new game with ' + s.seats.length + ' players.' });
    const dealt: CardId[][] = s.seats.map(() => []);
    for (let round = 0; round < 5; round++) {
      for (let seat = 0; seat < s.seats.length; seat++) {
        const c = s.draw.pop();
        if (c === undefined) continue;
        s.seats[seat]!.hand.push(c);
        dealt[seat]!.push(c);
        if (s.draw.length === 0) { s.exhaustPending++; s.exhaustFlag = true; }
      }
    }
    dealt.forEach((cards, seat) => this.emit({ type: 'deal', seat, cards, text: this.name(seat) + ' was dealt ' + cards.length + ' cards.' }));
    // Play Immediately cards dealt here wait for that seat's first turn
    s.turn = 0;
    await this.runTurns(true);
  }

  /** Start the current seat's turn without dealing, for hands set up some other way (tests, tutorials). */
  async beginTurn(): Promise<void> {
    if (this.state.turn < 0) this.state.turn = 0;
    await this.runTurns(true);
  }

  // ======== GameApi

  canPlay(seat: Seat, slot: number): ActionResult {
    const s = this.state;
    if (s.over) return no('The game is over.');
    if (seat !== s.turn) return no("It isn't your turn.");
    const card = s.seats[seat]?.hand[slot];
    if (card === undefined) return no('That card is no longer in your hand.');
    if (isWall(card)) return no('Wall Sections are built, not played.');
    const ok = this.opts.rules.check(s, seat, card);
    if (!ok.ok) return ok;
    if (actionCost(card) > s.actionsLeft) return no('Not enough actions left.');
    return { ok: true };
  }

  buildOptions(seat: Seat): { slot: number; pay: Exclude<BuildPayment, 'free'> }[] {
    const s = this.state;
    if (s.over || seat !== s.turn || s.actionsLeft < 1) return [];
    const hand = s.seats[seat]!.hand;
    const manHour = hand.indexOf(MAN_HOUR);
    const out: { slot: number; pay: Exclude<BuildPayment, 'free'> }[] = [];
    hand.forEach((c, slot) => {
      if (!isWall(c)) return;
      if (manHour >= 0) out.push({ slot, pay: { manHour } });
      const others = hand.flatMap((o, i) => (i !== slot && isWall(o) ? [i] : []));
      if (others.length >= 2) out.push({ slot, pay: { walls: [others[0]!, others[1]!] } });
    });
    return out;
  }

  debtTargets(seat: Seat): WallRef[] { return board.debtTargets(this.state, seat); }
  trainPairs(seat: Seat): WallRef[] { return board.trainPairs(this.state, seat); }
  miles(seat: Seat): number { return board.miles(this.state, seat); }
  sets(seat: Seat): number { return board.sets(this.state, seat); }

  /** A player's action on their own turn. Bots act through their BotPlayer instead. */
  async act(seat: Seat, action: Action): Promise<ActionResult> {
    const s = this.state;
    if (s.over) return no('The game is over.');
    if (this.busy) return no('Please wait: something is still happening.');
    if (seat !== s.turn) return no("It isn't your turn.");
    if (s.seats[seat]!.bot) return no('Bots take their own turns.');
    if (action.type === 'endTurn') {
      this.emit({ type: 'turnEnd', seat, text: this.name(seat) + ' ended their turn.' });
      await this.runTurns(false);
      return { ok: true };
    }
    this.busy = true;
    try {
      return await this.perform(seat, action);
    } finally {
      this.busy = false;
    }
  }

  /** An online player left: they get no more turns or cards. */
  async leave(seat: Seat): Promise<void> {
    const s = this.state, p = s.seats[seat];
    if (!p || p.left || s.over) return;
    p.left = true;
    this.emit({ type: 'announce', seat, text: this.name(seat) + ' left the game.' });
    if (board.activeSeats(s).length < 2) {
      this.gameOver('Everyone else left the game.');
      return;
    }
    if (s.turn === seat && !this.busy) await this.runTurns(false);
  }

  // ======== turns

  /**
   * Runs turns until a human has to act or the game ends. `first` = start the current seat's turn
   * without moving on (the first turn); otherwise move to the next seat first.
   */
  private async runTurns(first: boolean): Promise<void> {
    this.busy = true;
    try {
      await this.turnLoop(first);
    } finally {
      this.busy = false;
    }
  }

  private async turnLoop(first: boolean): Promise<void> {
    let advance = !first;
    while (!this.state.over) {
      if (advance && !this.nextSeat()) return;
      advance = true;
      const seat = this.state.turn;
      if (this.opts.beforeTurn) await this.opts.beforeTurn(seat);
      const play = await this.startTurn();
      if (this.state.over) return;
      if (!play) continue;                                  // Quarantined: the turn is skipped
      if (!this.state.seats[seat]!.bot) return;             // wait for the human
      await this.botTurn(seat);
    }
  }

  /** `Start Turn`. Returns false if the turn is skipped (Quarantine) or the game ended. */
  private async startTurn(): Promise<boolean> {
    const s = this.state, seat = s.turn, p = s.seats[seat]!;
    s.actionsLeft = s.settings.actionsPerTurn;
    s.turnCount++;
    this.emit({ type: 'turnStart', seat, text: "It's " + this.name(seat) + "'s turn." });
    // Jail release
    if (s.jail.length > 0 && s.turnCount >= s.jailRelease) {
      const freed = s.jail.splice(0);
      s.discard.push(...freed);
      this.emit({ type: 'jailRelease', cards: freed, text: 'The jailed cards were released to the discard pile.' });
    }
    // 1-action limit (Democrat Border / Puppeteer)
    if (p.limitNext > 0) {
      const c = p.limitNext;
      s.discard.push(c);
      p.limitNext = 0;
      s.actionsLeft = 1;
      this.emit({ type: 'limited', seat, card: c, text: this.name(seat) + ' has only 1 action (' + cardName(c) + ').' });
    }
    // Draw, counting each time the draw pile runs out
    const drawn: CardId[] = [];
    for (let i = 0; i < s.settings.cardsPerTurn; i++) {
      this.reshuffleIfEmpty();
      const c = s.draw.pop();
      if (c === undefined) continue;
      if (s.draw.length === 0) { s.exhaustPending++; s.exhaustFlag = true; }
      p.hand.push(c);
      drawn.push(c);
    }
    this.emit({ type: 'draw', seat, cards: drawn, text: this.name(seat) + ' drew ' + plural(drawn.length, 'card') + '.' });
    this.checkExhaust();
    this.winCheck(false);
    if (s.over) return false;
    await this.resolveImmediates();
    if (s.over) return false;
    // Quarantine: blocked at most once, when it was played (owner decision #6), so no second offer here
    if (p.skipNext) {
      p.skipNext = false;
      s.discard.push(QUARANTINE);
      this.emit({ type: 'skipped', seat, card: QUARANTINE, text: this.name(seat) + ' is in Quarantine: they drew their cards but skip the rest of this turn.' });
      return false;
    }
    return true;
  }

  /** `Next Turn`: finish a final round if it's over, then move to the next seat still in the game. */
  private nextSeat(): boolean {
    const s = this.state, n = s.seats.length;
    if (s.over) return false;
    let next = s.turn, reachedStop = false;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      // NOTE: the old game only compared the very next seat with Final Stop; walking past left seats
      // too means a final round still ends if the seat that started it has left.
      if (s.final && next === s.final.stop) reachedStop = true;
      if (!s.seats[next]!.left) break;
    }
    if (s.final && reachedStop) {
      if (s.final.kind === 'deck') s.deckDone = true;
      this.winCheck(true);
      if (s.over) return false;
    }
    s.turn = next;
    return true;
  }

  private async botTurn(seat: Seat): Promise<void> {
    const s = this.state;
    for (let i = 0; i < BOT_ACTION_LIMIT && !s.over && s.turn === seat && s.actionsLeft >= 1; i++) {
      if (this.opts.beforeBotAction) await this.opts.beforeBotAction(seat);
      if (s.over || s.turn !== seat) break;
      const action = this.opts.bot.nextAction(this, seat);
      if (action.type === 'endTurn') break;
      const r = await this.perform(seat, action);
      if (!r.ok) break;
    }
    if (!s.over && s.turn === seat) this.emit({ type: 'turnEnd', seat, text: this.name(seat) + ' ended their turn.' });
  }

  // ======== actions

  private async perform(seat: Seat, action: Action): Promise<ActionResult> {
    if (action.type === 'build') {
      const r = this.build(seat, action.slot, action.pay);
      if (r.ok) await this.resolveNow();
      return r;
    }
    if (action.type === 'play') return this.play(seat, action.slot);
    return { ok: true };
  }

  /** `do build`: build the wall card at `slot`, paying with a Man Hour or 2 other wall cards (section 5). */
  private build(seat: Seat, slot: number, pay: BuildPayment): ActionResult {
    const s = this.state, hand = s.seats[seat]!.hand;
    const card = hand[slot];
    if (card === undefined) return no('That card is no longer in your hand.');
    if (!isWall(card)) return no('Only Wall Sections can be built.');
    if (pay === 'free') return no('Free builds come from cards like Assassin.');
    if (s.actionsLeft < 1) return no('No actions left.');
    let paySlots: number[];
    if ('manHour' in pay) {
      if (hand[pay.manHour] !== MAN_HOUR || pay.manHour === slot) return no('That Man Hour is no longer in your hand.');
      paySlots = [pay.manHour];
    } else {
      const [a, b] = pay.walls;
      if (a === b || a === slot || b === slot || !isWall(hand[a] ?? 0) || !isWall(hand[b] ?? 0)) return no('Pick 2 other Wall Sections to discard.');
      paySlots = [a, b];
    }
    const paid = paySlots.map(i => hand[i]!);
    // Remove from the highest slot down so the other slots stay valid
    for (const i of [slot, ...paySlots].sort((x, y) => y - x)) hand.splice(i, 1);
    s.discard.push(...paid);
    s.seats[seat]!.walls.push(card);
    s.actionsLeft -= 1;
    this.emit({ type: 'build', seat, card, cards: paid,
      text: this.name(seat) + ' built ' + cardName(card) + ('manHour' in pay ? ' with a Man Hour.' : ' by discarding 2 other walls.') });
    this.trainCheck();
    return { ok: true };
  }

  /** Play a non-wall card: check it, pay for it, run its effect (section 6, `special run`). */
  private async play(seat: Seat, slot: number): Promise<ActionResult> {
    const ok = this.canPlay(seat, slot);
    if (!ok.ok) return ok;
    const s = this.state, hand = s.seats[seat]!.hand;
    const card = hand.splice(slot, 1)[0]!;
    const cost = actionCost(card);
    s.actionsLeft -= cost;
    this.pendingPlay = { type: 'play', seat, card, text: this.name(seat) + ' played ' + cardName(card) + '.' };
    const done = await this.opts.rules.run(this.context(seat, card));
    if (!done) {                                            // backed out before anything happened
      this.pendingPlay = null;
      hand.splice(slot, 0, card);
      s.actionsLeft += cost;
      return no('Cancelled.');
    }
    this.flushPlay();
    this.trainCheck();
    await this.resolveNow();
    return { ok: true };
  }

  /** `Resolve Now`: Play Immediately cards, then draw pile and win checks. */
  private async resolveNow(): Promise<void> {
    await this.resolveImmediates();
    this.checkExhaust();
    this.winCheck(false);
  }

  /** `resolve immediates`: the current player plays their first red card, again and again (section 7). */
  private async resolveImmediates(): Promise<void> {
    const s = this.state;
    for (let n = 0; n < IMMEDIATE_LIMIT && !s.over; n++) {
      const seat = s.turn, hand = s.seats[seat]!.hand;
      const slot = hand.findIndex(isImmediate);
      if (slot < 0) return;
      const card = hand.splice(slot, 1)[0]!;
      s.discard.push(card);
      this.emit({ type: 'immediate', seat, card, text: 'PLAY IMMEDIATELY: ' + this.name(seat) + ' drew ' + cardName(card) + '.' });
      await this.opts.rules.runImmediate(this.context(seat, card));
      this.trainCheck();
    }
  }

  // ======== the draw pile and the end of the game

  private reshuffleIfEmpty(): void {
    const s = this.state;
    if (s.draw.length === 0 && s.discard.length > 0) {
      s.draw = insertionShuffle(s, [...s.draw, ...s.discard.splice(0)]);
      this.emit({ type: 'reshuffle', text: 'The discard pile was shuffled into the draw pile.' });
    }
  }

  /** `check exhaust`: count each time the draw pile ran out; with endings 2-4 that can start the deck final round. */
  private checkExhaust(): void {
    const s = this.state, set = s.settings;
    if (s.draw.length === 0) {
      if (!s.exhaustFlag) { s.exhaustPending++; s.exhaustFlag = true; }
    } else {
      s.exhaustFlag = false;
    }
    while (s.exhaustPending >= 1 && !s.over) {
      s.exhaustPending--;
      s.exhaustCount++;
      if (set.ending !== 1 && !s.deckDone && !s.final) {
        if (s.exhaustCount >= set.endingTimes) {
          s.final = { kind: 'deck', stop: s.turn, reason: '' };
          this.emit({ type: 'finalRound', seat: s.turn, text: 'The last card was drawn! Everyone else gets one final turn.' });
        } else {
          this.emit({ type: 'exhausted', text: 'The draw pile ran out (' + s.exhaustCount + ' of ' + set.endingTimes + ' times). The discard pile is shuffled in.' });
        }
      }
    }
  }

  /** `win check` (section 10). `finalDone` = a final round just finished. */
  private winCheck(finalDone: boolean): void {
    const s = this.state, ending = s.settings.ending;
    if (s.over) return;
    const maxSets = Math.max(0, ...s.seats.map((_, i) => board.sets(s, i)));
    let end = false, reason = '';
    if ((ending === 1 || ending === 3) && maxSets >= 3) { end = true; reason = 'Someone built 3 sets of 3 walls.'; }
    if ((ending === 2 || ending === 3) && s.deckDone) { end = true; reason = 'The deck ran out and the final turns are done.'; }
    if (ending === 4 && s.deckDone && maxSets >= 3) { end = true; reason = 'Both the deck and 3 sets are done.'; }
    if (finalDone) {
      const final = s.final;
      s.final = null;
      if (final?.kind === 'sets') { end = true; reason = final.reason; }
      if (end) this.gameOver(reason);
    } else if (end && !s.final) {
      s.final = { kind: 'sets', stop: s.turn, reason };
      this.emit({ type: 'finalRound', seat: s.turn, text: 'Final round! ' + reason + ' Everyone else gets one final turn.' });
    }
  }

  /** `game over`: most miles wins; ties share the win. */
  private gameOver(reason: string): void {
    const s = this.state;
    const miles = s.seats.map((_, i) => board.miles(s, i));
    const best = Math.max(...miles);
    const winners = miles.flatMap((m, i) => (m === best ? [i] : []));
    s.over = { winners, miles, reason };
    s.final = null;
    const names = winners.map(w => this.name(w)).join(' & ');
    this.emit({ type: 'gameOver', text: (winners.length > 1 ? "It's a tie: " + names : names + ' wins!') + ' ' + reason + ' Most miles: ' + best + '.' });
  }

  // ======== what card effects use

  private context(player: Seat, card: CardId): EffectContext {
    const s = this.state;
    return {
      state: s, player, card,
      emit: e => this.emit(e),
      decide: <D extends Decision>(d: D) => this.decide(d),
      random: () => nextRandom(s),
      randomInt: (min, max) => randomInt(s, min, max),
      shuffleDraw: () => { s.draw = insertionShuffle(s, s.draw); },
      activeSeats: () => board.activeSeats(s),
      opponents: seat => board.opponents(s, seat),
      difficulty: seat => s.seats[seat]?.bot ?? null,
      draw: (seat, n) => this.drawCards(seat, n),
      takeFromHand: (seat, slot) => {
        const hand = s.seats[seat]!.hand;
        if (slot < 0 || slot >= hand.length) throw new Error('No card in slot ' + slot + ' of seat ' + seat);
        return hand.splice(slot, 1)[0]!;
      },
      addToHand: (seat, c) => { s.seats[seat]!.hand.push(c); },
      discard: c => { s.discard.push(c); },
      spendActions: n => { s.actionsLeft = Math.max(0, s.actionsLeft - n); },
      addActions: n => { s.actionsLeft += n; },
      buildFree: (seat, slot) => this.buildFree(seat, slot),
      wallCount: (seat, kind) => board.wallCount(s, seat, kind),
      eligibleWalls: seat => board.eligibleWalls(s, seat),
      moveWall: (from, to) => this.moveWall(from, to),
      isGuarded: w => board.isGuarded(s, w),
      miles: seat => board.miles(s, seat),
      defend: (target, attacker, c) => this.defend(target, attacker, c),
      trainCheck: () => this.trainCheck(),
    };
  }

  private async decide<D extends Decision>(d: D): Promise<Answer<D>> {
    const a = await this.opts.deciderFor(d.seat).decide(d, this.state);
    // The player picked someone for the card they're playing: the 'play' event names them
    const p = this.pendingPlay;
    if (p && p.seat === d.seat && p.target === undefined && a !== null) {
      const target = d.kind === 'chooseSeat' && d.options.includes(a as Seat) ? a as Seat
        : d.kind === 'chooseWall' && d.options.some(o => o.seat === (a as WallRef).seat) ? (a as WallRef).seat : undefined;
      if (target !== undefined && target !== p.seat) {
        p.target = target;
        p.text = this.name(p.seat) + ' played ' + cardName(p.card!) + ' on ' + this.name(target) + '.';
      }
    }
    return a;
  }

  /** `draw cards`: reshuffles the discard pile in when the draw pile is empty. (Exhaust is counted by check exhaust.) */
  private drawCards(seat: Seat, n: number): CardId[] {
    const s = this.state, out: CardId[] = [];
    for (let i = 0; i < n; i++) {
      this.reshuffleIfEmpty();
      const c = s.draw.pop();
      if (c === undefined) break;
      s.seats[seat]!.hand.push(c);
      out.push(c);
    }
    this.emit({ type: 'draw', seat, cards: out, text: this.name(seat) + ' drew ' + plural(out.length, 'card') + '.' });
    return out;
  }

  private buildFree(seat: Seat, slot: number): void {
    const hand = this.state.seats[seat]!.hand, card = hand[slot];
    if (card === undefined || !isWall(card)) throw new Error('No Wall Section in slot ' + slot);
    hand.splice(slot, 1);
    this.state.seats[seat]!.walls.push(card);
    this.emit({ type: 'build', seat, card, text: this.name(seat) + ' built ' + cardName(card) + ' for free.' });
    this.trainCheck();
  }

  private moveWall(from: WallRef, to: { walls: Seat } | { hand: Seat }): void {
    const walls = this.state.seats[from.seat]!.walls, i = walls.indexOf(from.kind);
    if (i < 0) throw new Error('Seat ' + from.seat + ' has no ' + cardName(from.kind));
    walls.splice(i, 1);
    const dest = 'walls' in to ? to.walls : to.hand;
    if ('walls' in to) this.state.seats[to.walls]!.walls.push(from.kind);
    else this.state.seats[to.hand]!.hand.push(from.kind);
    this.emit({ type: 'wallMoved', seat: from.seat, target: dest, card: from.kind,
      text: cardName(from.kind) + ' moved from ' + this.name(from.seat) + "'s walls to " + this.name(dest) + ('walls' in to ? "'s walls." : "'s hand.") });
    this.trainCheck();
  }

  /** `defend`: offer the target their Self-Defense; a block discards it (section 8). */
  private async defend(target: Seat, attacker: Seat, card: CardId): Promise<boolean> {
    const s = this.state, hand = s.seats[target]?.hand;
    if (!hand || !hand.includes(SELF_DEFENSE)) return false;
    const yes = await this.decide({ kind: 'block', seat: target, attacker, card });
    const i = hand.indexOf(SELF_DEFENSE);
    if (!yes || i < 0) return false;
    hand.splice(i, 1);
    s.discard.push(SELF_DEFENSE);
    this.emit({ type: 'blocked', seat: target, target: attacker, card,
      text: this.name(target) + ' blocked ' + cardName(card) + ' with Self-Defense.' });
    return true;
  }

  /** `train check`: a guarded pair that became a set of 3 loses its guard; the Trump Train is discarded. */
  trainCheck(): void {
    const s = this.state;
    s.trainGuards = s.trainGuards.filter(g => {
      if (board.wallCount(s, g.seat, g.kind) <= 2) return true;
      s.discard.push(TRUMP_TRAIN);
      this.emit({ type: 'trainGuardRemoved', seat: g.seat, card: g.kind,
        text: this.name(g.seat) + "'s " + cardName(g.kind) + ' is a full set now, so its Trump Train was discarded.' });
      return false;
    });
  }

  private name(seat: Seat): string { return board.seatName(this.state, seat); }
  // A 'play' event waits until the card's effect does something, so a card the player backs out of
  // is never announced (or learned from by the bots)
  private pendingPlay: GameEvent | null = null;
  private emit(e: GameEvent): void {
    if (this.pendingPlay && e !== this.pendingPlay) this.flushPlay();
    this.emitFn(e);
  }
  private flushPlay(): void {
    const p = this.pendingPlay;
    this.pendingPlay = null;
    if (p) this.emitFn(p);
  }
}

const no = (reason: string): ActionResult => ({ ok: false, reason });
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
