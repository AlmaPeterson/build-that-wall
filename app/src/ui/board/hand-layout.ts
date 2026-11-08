// Where each card of a hand goes. The hand is sorted by the colour of the cards (their type), copies of
// the same card are stacked, each one a little lower than the one under it so every card's title shows,
// and everything shrinks to fit: the whole hand is always in view, nothing scrolls.
// Pure functions: the hand (board/Hand.tsx) and the flying cards (anim/layout.ts) both use them.
import { cardById, isWall, CARD, type CardId } from '../../data/cards';

/** The hand box on the stage, in stage units (board.css .hand). */
export const HAND_BOX = { x: 5, y: 218, w: 464, h: 84 };
/** The box's border width, in stage units. Card spots are measured from inside it (CSS absolute positioning). */
export const HAND_BORDER = 1.5;
/** Where cards can go inside the border (the box is 461 × 81 in there). */
const INNER = { x: 4, y: 3.5, w: 453, h: 74 };

/** The full-size card in the hand, in stage units (the old game's size). */
const CARD_W = 49, CARD_H = 67;
/** Each card in a stack sits this much of a card's height lower than the one under it: the title shows. */
const STACK_STEP = 0.18;
/** Never show cards smaller than this (stage units wide): past it, stacks overlap sideways instead. */
const MIN_W = 30;
/** Space between stacks, as a share of the card width (11 units at full size, as before). */
const GAP = 11 / 49, MIN_GAP = 3 / 49;

/**
 * Left-to-right order of the card colours: brown Wall Sections, orange Man Hour, purple Trump and Trump
 * Train, navy actions, light-blue pack cards, green Debt and Savings, grey Self Defense, red Play Immediately.
 */
export function colourRank(id: CardId): number {
  if (isWall(id)) return 0;
  if (id === CARD.ManHour) return 1;
  if (id === CARD.Trump || id === CARD.TrumpTrain) return 2;
  if (id === CARD.Debt || id === CARD.Savings) return 5;
  if (id === CARD.SelfDefense) return 6;
  const c = cardById(id);
  if (c.category === 'immediate') return 7;
  if (c.category === 'action') return c.count > 0 ? 3 : 4;   // pack cards aren't in the base deck
  return 8;
}

export interface Stack { id: CardId; slots: number[] }

/** The cards of `hand` (or just `slots` of it) grouped by card, in colour order; each stack's slots oldest first. */
export function stacks(hand: readonly CardId[], slots: readonly number[] = hand.map((_, k) => k)): Stack[] {
  const by = new Map<CardId, number[]>();
  for (const k of slots) {
    const id = hand[k];
    if (id === undefined) continue;
    by.set(id, [...(by.get(id) ?? []), k]);
  }
  return [...by].map(([id, s]) => ({ id, slots: s }))
    .sort((a, b) => colourRank(a.id) - colourRank(b.id) || a.id - b.id);
}

/** Real slots of `hand` in the order they're shown (stack by stack, bottom card first). */
export function displayOrder(hand: readonly CardId[]): number[] {
  return stacks(hand).flatMap(s => s.slots);
}

export interface Spot { x: number; y: number; w: number; h: number; z: number }

/**
 * Where each slot of `hand` is drawn, relative to the hand box's top left, in stage units. Indexed by slot.
 * `z` is the stacking order (a card covers the ones with lower z).
 */
export function handLayout(hand: readonly CardId[]): Spot[] {
  const groups = stacks(hand);
  const out: Spot[] = new Array(hand.length);
  if (!groups.length) return out;
  const g = groups.length, deepest = Math.max(...groups.map(s => s.slots.length));

  // Tall enough for the deepest stack...
  let h = Math.min(CARD_H, INNER.h / (1 + (deepest - 1) * STACK_STEP));
  let w = h * CARD_W / CARD_H;
  // ...and narrow enough for every stack side by side
  const fits = (cw: number, gap: number) => g * cw + (g - 1) * gap <= INNER.w;
  let gap = w * GAP;
  if (!fits(w, gap)) {
    gap = Math.max(w * MIN_GAP, (INNER.w - g * w) / Math.max(1, g - 1));
    if (!fits(w, gap)) {
      w = Math.max(MIN_W, INNER.w / (g + (g - 1) * MIN_GAP));
      h = w * CARD_H / CARD_W;
      gap = w * MIN_GAP;
    }
  }
  // Still too wide (a huge hand at the smallest size): the stacks overlap sideways, each one's left edge showing
  let pitch = w + gap;
  if (g > 1 && w + (g - 1) * pitch > INNER.w) pitch = (INNER.w - w) / (g - 1);
  const step = deepest > 1 ? Math.min(h * STACK_STEP, (INNER.h - h) / (deepest - 1)) : 0;

  const width = w + (g - 1) * pitch;
  const left = INNER.x + Math.max(0, (INNER.w - width) / 2);   // centred
  let z = 1;
  groups.forEach((s, i) => {
    s.slots.forEach((slot, j) => {
      out[slot] = { x: left + i * pitch, y: INNER.y + j * step, w, h, z: z++ };
    });
  });
  return out;
}
