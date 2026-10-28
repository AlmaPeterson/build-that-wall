// Card groups and numbers the rules use (docs/game-rules.md sections 1, 6, 9).
import { cardById, isWall, type CardId } from '../data/cards';

export { isWall };

/** Play Immediately ("red") cards, in the order the old game checked them. */
export const IMMEDIATE: readonly CardId[] = [1, 2, 8, 10, 12, 15, 18, 24];
export const isImmediate = (id: CardId): boolean => IMMEDIATE.includes(id);

/** Actions it costs to play a card. */
export const actionCost = (id: CardId): number => cardById(id).cost;

/** Miles for how many sections of one kind a seat has built: 1 → 3, 2 → 8, 3+ → 16. */
export const milesFor = (count: number): number => (count >= 3 ? 16 : count === 2 ? 8 : count === 1 ? 3 : 0);

/** How much bots value a card when giving or picking (`ai give slot`, `pool pick`). */
export function cardValue(id: CardId): number {
  if (isWall(id)) return 5;
  if (id === 14) return 4;
  if ([25, 26, 19, 20, 28, 3, 13].includes(id)) return 3;
  if (id === 7) return 2;
  return 1;
}
