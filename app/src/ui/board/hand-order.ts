// The order you've arranged your hand in by dragging. It's only how the hand is shown on this device:
// the game keeps its own order (slot numbers), and everything you tap is mapped back to the real slot,
// so arranging cards can never confuse a question that's waiting on a slot.
import type { CardId, Seat } from '../../game';
import { createStore } from '../store';

/** Per seat: card ids in the order you put them. New cards go on the end. */
const orders = new Map<Seat, CardId[]>();
/** Bumped on every change, so the hand re-renders. */
export const handOrderVersion = createStore(0);

/** The real slots of `hand` in the order to show them. */
export function displayOrder(seat: Seat, hand: readonly CardId[]): number[] {
  const used = new Set<number>(), out: number[] = [];
  for (const id of orders.get(seat) ?? []) {
    const slot = hand.findIndex((c, k) => c === id && !used.has(k));
    if (slot >= 0) { used.add(slot); out.push(slot); }
  }
  hand.forEach((_, k) => { if (!used.has(k)) out.push(k); });
  return out;
}

/** Where real slot `slot` is shown (0 = leftmost). */
export function displayIndex(seat: Seat, hand: readonly CardId[], slot: number): number {
  const i = displayOrder(seat, hand).indexOf(slot);
  return i < 0 ? slot : i;
}

/** Move the card shown at position `from` to position `to`. */
export function moveCard(seat: Seat, hand: readonly CardId[], from: number, to: number): void {
  const order = displayOrder(seat, hand);
  if (from === to || from < 0 || from >= order.length) return;
  const [slot] = order.splice(from, 1);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, slot!);
  orders.set(seat, order.map(k => hand[k]!));
  handOrderVersion.update(n => n + 1);
}

/** A new game: everyone's hand back in the order it was dealt. */
export function resetHandOrders(): void {
  orders.clear();
  handOrderVersion.update(n => n + 1);
}
