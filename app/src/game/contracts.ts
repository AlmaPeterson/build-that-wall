// The contracts between the three parts of the game core, so they can be built separately:
//   engine/   runs the game: setup, dealing, drawing, turns, building, playing, endings, scoring.
//             It implements EffectContext and GameApi.
//   effects/  what each card does (section 9 of docs/game-rules.md), written against EffectContext.
//             It provides CardRules.
//   bots/     how bots play (section 11). It provides a BotPlayer and bot Deciders, written against GameApi.
import type { Action, ActionResult, Answer, BuildPayment, CardId, Decision, Difficulty, Emit, GameState, Seat, WallRef } from './types';

/** What a card effect may use. The engine provides one per effect run. */
export interface EffectContext {
  readonly state: GameState;
  /** Who played (or drew, for Play Immediately cards) the card. */
  readonly player: Seat;
  readonly card: CardId;
  readonly emit: Emit;
  /** Ask a seat (routed to its human UI, bot or remote player). */
  decide<D extends Decision>(d: D): Promise<Answer<D>>;

  // ---- random (from the game's seeded generator)
  random(): number;
  randomInt(min: number, max: number): number;
  shuffleDraw(): void;                               // re-shuffle the draw pile by random insertion

  // ---- seats
  /** Seats still in the game (not left), in seat order. */
  activeSeats(): Seat[];
  /** Other active seats, in seat order starting after `seat` (clockwise). */
  opponents(seat: Seat): Seat[];
  difficulty(seat: Seat): Difficulty | null;         // null = human

  // ---- cards
  /** Take up to n cards for a seat from the draw pile (reshuffling the discard pile in when empty). Returns what was drawn. */
  draw(seat: Seat, n: number): CardId[];
  /** Remove the card at `slot` from a hand and return it. */
  takeFromHand(seat: Seat, slot: number): CardId;
  addToHand(seat: Seat, card: CardId): void;
  discard(card: CardId): void;
  spendActions(n: number): void;
  addActions(n: number): void;

  // ---- walls
  /** Build the wall card at `slot` for free (no action, no payment). Runs train check. */
  buildFree(seat: Seat, slot: number): void;
  /** How many sections of `kind` a seat has built. */
  wallCount(seat: Seat, kind: CardId): number;
  /** A seat's built sections that can be taken, given away or pulled back: not in a set of 3, not Train-guarded. One ref per kind. */
  eligibleWalls(seat: Seat): WallRef[];
  /** Move one built section to another seat's walls, or into a hand. Runs train check. */
  moveWall(from: WallRef, to: { walls: Seat } | { hand: Seat }): void;
  isGuarded(w: WallRef): boolean;
  miles(seat: Seat): number;

  // ---- blocking
  /** Offer `target` their Self-Defense against `attacker`'s card. True = blocked (Self-Defense discarded). */
  defend(target: Seat, attacker: Seat, card: CardId): Promise<boolean>;

  /** Remove guards whose pair became a set of 3; their Trump Train goes to the discard pile. */
  trainCheck(): void;
}

/** What effects/ gives the engine. */
export interface CardRules {
  /** Can `seat` play this card right now (ignoring action cost)? Section 6, `fx check`. */
  check(state: GameState, seat: Seat, card: CardId): { ok: true } | { ok: false; reason: string };
  /**
   * Run the card's effect. Called after the engine removed the card from the hand and paid its cost.
   * The effect decides where the card goes: discard it, or hold it (9, 16, 17, 11, 25 protect, 27).
   * Return false only if the player backed out before anything happened (the engine then refunds:
   * puts the card back in the hand and restores the actions). Debt, Trump and Trump Train are effects too.
   */
  run(ctx: EffectContext): Promise<boolean>;
  /** Run a Play Immediately card for the current player (section 7). The engine has already discarded it. */
  runImmediate(ctx: EffectContext): Promise<void>;
}

/** Read-only questions and the actions a bot (or the UI) can use. The engine implements it. */
export interface GameApi {
  readonly state: Readonly<GameState>;
  /** Can `seat` play the card in `slot` now, including the action cost? */
  canPlay(seat: Seat, slot: number): ActionResult;
  /** Every legal build for `seat` now (section 5): for each wall slot, the payments available. */
  buildOptions(seat: Seat): { slot: number; pay: Exclude<BuildPayment, 'free'> }[];
  /** Opponent walls Debt could take (section 9, Debt). */
  debtTargets(seat: Seat): WallRef[];
  /** Built pairs a Trump Train could protect. */
  trainPairs(seat: Seat): WallRef[];
  miles(seat: Seat): number;
  sets(seat: Seat): number;
  act(seat: Seat, action: Action): Promise<ActionResult>;
}

/** Decides a bot's next action on its own turn (section 11, `ai think`). 'endTurn' = stop. */
export interface BotPlayer {
  nextAction(api: GameApi, seat: Seat): Action;
}

/** Remembers how humans play, for Hard bots (section 11, learning). */
export interface BotMemory {
  learn(name: string, what: 'game' | 'debt' | 'attack', miles?: number): void;
  rate(name: string, what: 'miles' | 'debt'): number;
}
