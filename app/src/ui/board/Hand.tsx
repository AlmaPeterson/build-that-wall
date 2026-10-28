// The viewer's hand: a scrollable row of cards (the old Hand Scrollbar). While picking walls, only the
// cards that can be picked are clickable.
import { cardById, type CardId } from '../../data/cards';
import { useEffect, useRef } from 'preact/hooks';
import { HAND_WIDTH_UNITS, setHandScroll } from '../anim/layout';
import { cardImage } from '../assets';
import { zoomProps } from '../components/zoom';

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
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // The mouse wheel scrolls the hand sideways (it only scrolls up and down by itself)
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? d * 40 : d;   // lines → pixels
    };
    // Flying cards aim at the right slot of a scrolled hand
    const scroll = () => { setHandScroll(el.scrollLeft / (el.offsetWidth / HAND_WIDTH_UNITS)); };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', scroll);
    scroll();
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('scroll', scroll); setHandScroll(0); };
  }, []);
  return (
    <>
      <div class="at hand__title">Your Hand</div>
      <div class="at hand" role="list" aria-label="Your hand" ref={row}>
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
export function HiddenHand({ lastCard, message = 'Hands are hidden while the computer plays' }: { lastCard: CardId | null; message?: string }) {
  return (
    <>
      <div class="at hand__title">Your Hand</div>
      <div class="at hand__hidden" aria-live="polite">
        {lastCard !== null && <img src={cardImage(lastCard, 'thumb')} alt={cardById(lastCard).name} {...zoomProps(lastCard)} />}
        <span>{message}</span>
      </div>
    </>
  );
}
