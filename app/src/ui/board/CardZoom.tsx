// A card shown full size with its text, over everything (board, prompts, pass screen). Opened by tapping
// any face-up card (components/zoom.ts).
import { zoomedCard } from '../components/zoom';
import { useStore } from '../store';
import { CardPopup } from './CardPopup';
import './board.css';

export function CardZoom() {
  const card = useStore(zoomedCard);
  if (card === null) return null;
  const close = () => zoomedCard.set(null);
  return (
    <div class="card-zoom" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div class="stage card-zoom__stage">
        <CardPopup card={card} actions={{ buttons: [], note: '' }} onChoose={() => {}} onClose={close} />
      </div>
    </div>
  );
}
