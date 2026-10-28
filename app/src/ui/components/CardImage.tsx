import type { JSX } from 'preact';
import { cardById, type CardId } from '../../data/cards';
import { cardImage, type CardSize } from '../assets';
import { zoomProps } from './zoom';

interface Props extends Omit<JSX.HTMLAttributes<HTMLImageElement>, 'id' | 'size'> {
  id: CardId;
  size?: CardSize;
  /** Tap to see it full size. */
  zoomable?: boolean;
}

/** A card's picture with its name as the alt text. Card 4 is the card back. */
export function CardImage({ id, size = 'card', zoomable = false, ...rest }: Props) {
  const zoom = zoomable && id !== 4 ? zoomProps(id) : {};
  return <img src={cardImage(id, size)} alt={id === 4 ? 'A card' : cardById(id).name} draggable={false} {...rest} {...zoom} />;
}
