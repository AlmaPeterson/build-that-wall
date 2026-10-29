// Any face-up card on screen can be tapped to see it full size (ui/board/CardZoom.tsx shows it).
import type { CardId } from '../../data/cards';
import { createStore } from '../store';

const CARD_BACK = 4;

export const zoomedCard = createStore<CardId | null>(null);

export function showCard(id: CardId | null | undefined): void {
  if (id !== null && id !== undefined && id !== CARD_BACK) zoomedCard.set(id);
}

/**
 * Double-click or right-click opens `id` full size, with its Zoom In and Scan QR Code buttons. For cards whose
 * single click does something else (a hand card's actions, picking a card in a question). `before` runs first,
 * e.g. to close the actions popup the first click opened.
 */
export function cardMenuProps(id: CardId, before?: () => void) {
  const open = (e: Event) => { e.preventDefault(); e.stopPropagation(); before?.(); showCard(id); };
  return { onDblClick: open, onContextMenu: open, 'data-card': id };
}

/**
 * A double/right-click that landed on a layer over the board (cards flying): open the face-up card underneath,
 * if there is one (every card that can be opened carries data-card). Returns whether it found one.
 */
export function openCardBelow(e: MouseEvent, layer: Element): boolean {
  const below = document.elementsFromPoint?.(e.clientX, e.clientY) ?? [];
  for (const el of below) {
    if (el === layer || layer.contains(el)) continue;
    const id = Number(el.closest('[data-card]')?.getAttribute('data-card'));
    if (Number.isFinite(id) && id !== CARD_BACK && el.closest('[data-card]')) {
      e.preventDefault();
      showCard(id);
      return true;
    }
  }
  return false;
}

/** Props that make an element open `id` full size when tapped (or Enter/Space when focused), or double/right-clicked. */
export function zoomProps(id: CardId) {
  return {
    role: 'button' as const, tabIndex: 0, title: 'Tap to see this card full size', style: { cursor: 'zoom-in' },
    ...cardMenuProps(id),
    onClick: (e: Event) => { e.stopPropagation(); showCard(id); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCard(id); } },
  };
}
