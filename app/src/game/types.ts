// The game's shared types. Everything the engine, the card effects, the bots and the UI agree on.
// The rules themselves are in docs/game-rules.md; section numbers below refer to it.
//
// Seats are 0-based here (seat 0 = "seat 1" / "P1" in the old game and in game-rules.md).
import type { CardId } from '../data/cards';

export type { CardId };
export type Seat = number;
export type Difficulty = 'easy' | 'medium' | 'hard';

/** 1 "3 Sets of 3 Walls", 2 "Exhaust Deck", 3 "Whatever Happens First", 4 "Whatever Happens Last" (section 10). */
export type Ending = 1 | 2 | 3 | 4;

/** What a game is started with (section 2). */
export interface GameSettings {
  players: number;               // 2-6 seats
  bots: number;                  // bots take the last seats; bots = players is watch mode
  difficulties: (Difficulty | 'random')[];   // per bot: difficulties[k] is bot k (seat players - bots + k)
  names: string[];               // per seat; '' = default ("Player k" / bot name)
  ending: Ending;
  endingTimes: 1 | 2;            // how many times the draw pile must run out (endings 2-4)
  actionsPerTurn: number;        // 3
  cardsPerTurn: number;          // 3
  packCards: CardId[];           // extra cards from active expansion packs (none yet)
  firstSeat?: Seat;              // who goes first; default a random player (the Tutorial and tests set it)
}

export const DEFAULT_SETTINGS: GameSettings = {
  players: 2, bots: 1, difficulties: ['medium'], names: [], ending: 1, endingTimes: 1,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [],
};

/** One built wall section belongs to a seat and is of one kind (a Wall Section card id 29-44). */
export interface WallRef { seat: Seat; kind: CardId }

export type FinalKind = 'sets' | 'deck';

/**
 * The whole game, as plain data: JSON-serialisable so it can be saved and sent to online players.
 * Piles are arrays; the TOP of the draw pile is the LAST item (as in the old game).
 */
export interface GameState {
  settings: GameSettings;
  rng: number;                   // seeded random generator state (see rng.ts)
  seats: SeatState[];
  draw: CardId[];
  discard: CardId[];
  jail: CardId[];                // Freedom of the Press: jailed cards, including the card itself
  jailRelease: number;           // turnCount at which the jail empties
  trainGuards: WallRef[];        // pairs protected by a Trump Train (the Trump Train card is held here)
  turn: Seat;                    // whose turn it is; -1 before the first turn
  turnCount: number;             // turns started this game
  actionsLeft: number;
  exhaustCount: number;          // times the draw pile has run out
  exhaustPending: number;
  exhaustFlag?: boolean;         // the draw pile is empty and that has already been counted (engine bookkeeping)
  final: { kind: FinalKind; stop: Seat; reason: string } | null;   // a final round in progress
  deckDone: boolean;
  over: GameResult | null;
}

export interface SeatState {
  name: string;
  bot: Difficulty | null;        // null = human
  hand: CardId[];                // order matters: slot numbers are indexes
  walls: CardId[];               // built sections, one entry each (a pair is two equal entries)
  skipNext: boolean;             // Quarantined for the next turn
  skipBy: Seat;                  // who Quarantined them
  limitNext: CardId;             // 9 or 16 held here: 1 action next turn; 0 = none
  left: boolean;                 // an online player who left the game
}

export interface GameResult {
  winners: Seat[];               // several on a tie
  miles: number[];               // per seat
  reason: string;
}

// ---- Decisions: whenever a rule needs someone to choose, the engine asks that seat's Decider.
// Humans answer through the UI, bots through bots/, remote online players through the room.

export type Decision =
  /** Use Self-Defense to block this attack? (section 8) */
  | { kind: 'block'; seat: Seat; attacker: Seat; card: CardId }
  /** Use Savings to pay this Debt? */
  | { kind: 'paySavings'; seat: Seat; attacker: Seat }
  /** Pick an opponent for a card. cancellable: the player may back out before anything is spent. */
  | { kind: 'chooseSeat'; seat: Seat; card: CardId; options: Seat[]; cancellable: boolean }
  /** Pick a built wall section (Debt target, Afghanistan, Riot, Trump Train pair, Spy Balloon guard). */
  | { kind: 'chooseWall'; seat: Seat; card: CardId; options: WallRef[]; cancellable: boolean }
  /** Pick a card from your own hand (by slot), e.g. which card to give to `to` when handing out. */
  | { kind: 'chooseHandCard'; seat: Seat; card: CardId; purpose: 'give' | 'build'; options: number[]; to?: Seat; optional: boolean }
  /** Pick up to `max` cards from a pool (piles shown grouped by kind). Answer: card ids. */
  | { kind: 'pickCards'; seat: Seat; card: CardId; pool: CardId[]; max: number }
  /** Pick one of named options, e.g. Trump Train 'draw' | 'protect', Spy Balloon 'take' | 'remove'. */
  | { kind: 'chooseOption'; seat: Seat; card: CardId; options: string[]; cancellable: boolean };

/** What each decision is answered with. null = cancel / stop / skip (only where the decision allows it). */
export type Answer<D extends Decision> =
  D extends { kind: 'block' | 'paySavings' } ? boolean :
  D extends { kind: 'chooseSeat' } ? Seat | null :
  D extends { kind: 'chooseWall' } ? WallRef | null :
  D extends { kind: 'chooseHandCard' } ? number | null :
  D extends { kind: 'pickCards' } ? CardId[] :
  D extends { kind: 'chooseOption' } ? string | null :
  never;

export interface Decider {
  decide<D extends Decision>(d: D, state: Readonly<GameState>): Promise<Answer<D>>;
}

// ---- Events: what happened, for the UI (animations, announcements) and the turn recap.

export type GameEventType =
  | 'gameStart' | 'deal' | 'turnStart' | 'turnEnd' | 'draw' | 'reshuffle' | 'exhausted'
  | 'build' | 'play' | 'immediate' | 'discard' | 'blocked' | 'savings'
  | 'cardMoved' | 'wallMoved' | 'jail' | 'jailRelease' | 'limited' | 'quarantined' | 'skipped'
  | 'trainGuard' | 'trainGuardRemoved' | 'finalRound' | 'gameOver' | 'announce';

export interface GameEvent {
  type: GameEventType;
  text: string;                  // one plain sentence, e.g. "Bot 2 played Debt on Player 1's Wall Section 4."
  seat?: Seat;                   // who did it
  target?: Seat;                 // who it happened to
  card?: CardId;                 // the card involved
  cards?: CardId[];
}

export type Emit = (e: GameEvent) => void;

// ---- Actions a player takes on their own turn

export type BuildPayment = { manHour: number } | { walls: [number, number] } | 'free';   // slots

export type Action =
  | { type: 'build'; slot: number; pay: BuildPayment }
  | { type: 'play'; slot: number }   // any non-wall card; Debt, Trump Train etc. ask their questions through the Decider
  | { type: 'endTurn' };

export type ActionResult = { ok: true } | { ok: false; reason: string };
