// Where pictures and sounds are. Paths are relative to the page (Vite serves app/public at the root).
import { cardById, type CardId } from '../data/cards';
import manifest from '../data/assets.json';

export type CardSize = 'card' | 'high' | 'thumb' | 'mini';

/** A card's picture. Card 4 is the card back. Falls back to the full picture when a size is missing. */
export function cardImage(id: CardId, size: CardSize = 'card'): string {
  const img = cardById(id).image;
  return (size === 'card' ? img.card : img[size]) ?? img.card;
}

export const CARD_BACK_IMAGE = (): string => cardImage(4);

interface Costume { path: string; rotationCenterX: number; rotationCenterY: number; bitmapResolution: number }
const sprites = (manifest as unknown as { sprites: Record<string, { costumes: Record<string, Costume>; sounds: Record<string, { path: string }> }> }).sprites;

/** A costume from the old project, e.g. costume('Buttons', 'Start Game'). */
export function costume(sprite: string, name: string): Costume | null {
  return sprites[sprite]?.costumes[name] ?? null;
}

export function sound(sprite: string, name: string): string | null {
  return sprites[sprite]?.sounds[name]?.path ?? null;
}
