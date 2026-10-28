// The viewer's hand: a scrollable row of cards (the old Hand Scrollbar). While picking walls, only the
// cards that can be picked are clickable.
import { cardById, type CardId } from '../../data/cards';
import { cardImage } from '../assets';

export interface HandPicking {
  pickable: number[];   // slots that can be picked
  picked: number[];
}

interface Props {
  cards: readonly CardId[];
  onCard(slot: number): void;
  picking?: HandPicking | null;
}

export function Hand({ cards, onCard, picking }: Props) {
  return (
    <>
      <div class="at hand__title">Your Hand</div>
      <div class="at hand" role="list" aria-label="Your hand">
        {cards.map((id, slot) => {
          const pickable = picking ? picking.pickable.includes(slot) : true;
          const picked = picking?.picked.includes(slot) ?? false;
          const cls = ['hand__card', picking && pickable && !picked ? 'hand__card--pickable' : '', picked ? 'hand__card--picked' : '',
            picking && !pickable ? 'hand__card--dim' : ''].join(' ');
          return (
            <button type="button" role="listitem" class={cls} key={slot} disabled={!pickable} data-slot={slot}
              aria-pressed={picking ? picked : undefined} onClick={() => onCard(slot)} title={cardById(id).name}>
              <img src={cardImage(id, 'thumb')} alt={cardById(id).name} draggable={false} />
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Shown instead of the hand while a bot plays (and in watch mode), with the last card a bot played. */
export function HiddenHand({ lastCard }: { lastCard: CardId | null }) {
  return (
    <>
      <div class="at hand__title">Your Hand</div>
      <div class="at hand__hidden" aria-live="polite">
        {lastCard !== null && <img src={cardImage(lastCard, 'thumb')} alt={cardById(lastCard).name} />}
        <span>Hands are hidden while the computer plays</span>
      </div>
    </>
  );
}
