// A card from the hand, zoomed in, with what can be done with it (Alerts and Buttons › Play Popup).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { cardById, type CardId } from '../../data/cards';
import { cardImage } from '../assets';
import { Button } from '../components/Button';
import { RESIZE_TITLE, useDraggable } from '../components/drag';
import { cardMenuProps } from '../components/zoom';
import type { CardActions, CardChoice } from './board-state';

interface Props {
  card: CardId;
  actions: CardActions;
  onChoose(choice: CardChoice): void;
  onClose(): void;
  /** The closing button's label (default "Back"). */
  closeLabel?: string;
  /** More buttons, before the closing one (the full-size view's Zoom In and Scan QR Code). */
  extra?: ComponentChildren;
  /** Double/right-clicking the picture opens the full-size view (off in that view itself). */
  zoomable?: boolean;
  /**
   * The popup opened on the first click of a double-click: the second click lands on the popup, not the card,
   * so a click on it (not on a button) this soon after opening means "double-click" and calls this.
   */
  onDoubleClick?(): void;
}

/** A second click this soon after the popup opened is the rest of a double-click. */
export const DOUBLE_CLICK_MS = 400;

export function CardPopup({ card, actions, onChoose, onClose, closeLabel = 'Back', extra, zoomable = true, onDoubleClick }: Props) {
  const c = cardById(card);
  const opened = useRef(Date.now());
  const quickClick = (e: MouseEvent) => {
    if (!onDoubleClick || Date.now() - opened.current > DOUBLE_CLICK_MS) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.stopPropagation();
    onDoubleClick();
  };
  const drag = useDraggable('card');
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class={'zoom' + (drag.moved ? ' zoom--moved' : '')} role="dialog" aria-modal="true" aria-label={c.name}
      onClickCapture={quickClick} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Everything moves together when dragged; the gaps between the pieces stay the backdrop */}
      <div class="zoom__group drag-box" data-drag-children ref={drag.ref} style={drag.style}>
      <img class="zoom__card" src={cardImage(card, 'high')} alt={c.name} draggable={false} {...(zoomable ? cardMenuProps(card) : {})} />
      <Button class="zoom__close" aria-label="Close" onClick={onClose}>X</Button>
      <div class="zoom__text">
        <h3>{c.name}</h3>
        <div>{c.explain || c.effect}</div>
        {actions.note && <div class="zoom__note" role="note">{actions.note}</div>}
      </div>
      <div class="zoom__buttons">
        {actions.buttons.map(b => <Button key={b.label} onClick={() => onChoose(b.choice)}>{b.label}</Button>)}
        {extra}
        <Button onClick={onClose}>{closeLabel}</Button>
      </div>
      <span class="drag-grip zoom__grip" title={RESIZE_TITLE} aria-hidden="true" />
      </div>
    </div>
  );
}
