// Any face-up card on screen can be tapped to see it full size (ui/board/CardZoom.tsx shows it).
import type { CardId } from '../../data/cards';
import { createStore } from '../store';

const CARD_BACK = 4;

export const zoomedCard = createStore<CardId | null>(null);

export function showCard(id: CardId | null | undefined): void {
  if (id !== null && id !== undefined && id !== CARD_BACK) zoomedCard.set(id);
}

/** Props that make an element open `id` full size when tapped (or Enter/Space when focused). */
export function zoomProps(id: CardId) {
  return {
    role: 'button' as const, tabIndex: 0, title: 'Tap to see this card full size', style: { cursor: 'zoom-in' },
    onClick: (e: Event) => { e.stopPropagation(); showCard(id); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCard(id); } },
  };
}
