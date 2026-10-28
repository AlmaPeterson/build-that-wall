// A card from the hand, zoomed in, with what can be done with it (Alerts and Buttons › Play Popup).
import { useEffect } from 'preact/hooks';
import { cardById, type CardId } from '../../data/cards';
import { cardImage } from '../assets';
import { Button } from '../components/Button';
import { RESIZE_TITLE, useDraggable } from '../components/drag';
import type { CardActions, CardChoice } from './board-state';

interface Props {
  card: CardId;
  actions: CardActions;
  onChoose(choice: CardChoice): void;
  onClose(): void;
  /** The closing button's label (default "Back"). */
  closeLabel?: string;
}

export function CardPopup({ card, actions, onChoose, onClose, closeLabel = 'Back' }: Props) {
  const c = cardById(card);
  const drag = useDraggable('card');
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class={'zoom' + (drag.moved ? ' zoom--moved' : '')} role="dialog" aria-modal="true" aria-label={c.name} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Everything moves together when dragged; the gaps between the pieces stay the backdrop */}
      <div class="zoom__group drag-box" data-drag-children ref={drag.ref} style={drag.style}>
      <img class="zoom__card" src={cardImage(card, 'high')} alt={c.name} draggable={false} />
      <Button class="zoom__close" aria-label="Close" onClick={onClose}>X</Button>
      <div class="zoom__text">
        <h3>{c.name}</h3>
        <div>{c.explain || c.effect}</div>
        {actions.note && <div class="zoom__note" role="note">{actions.note}</div>}
      </div>
      <div class="zoom__buttons">
        {actions.buttons.map(b => <Button key={b.label} onClick={() => onChoose(b.choice)}>{b.label}</Button>)}
        <Button onClick={onClose}>{closeLabel}</Button>
      </div>
      <span class="drag-grip zoom__grip" title={RESIZE_TITLE} aria-hidden="true" />
      </div>
    </div>
  );
}
