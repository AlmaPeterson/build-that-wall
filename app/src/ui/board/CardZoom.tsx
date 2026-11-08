// A card shown full size with its text, over everything (board, prompts, pass screen). Opened by tapping
// any face-up card, or double/right-clicking one whose tap does something else (components/zoom.ts).
// Like every card popup, the wheel zooms the picture and Scan QR Code opens the card's page (CardPopup).
import { useStore } from '../store';
import { zoomedCard } from '../components/zoom';
import { CardPopup } from './CardPopup';
import './board.css';

export function CardZoom() {
  const card = useStore(zoomedCard);
  if (card === null) return null;
  const close = () => zoomedCard.set(null);
  return (
    <div class="card-zoom" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div class="stage card-zoom__stage">
        <CardPopup card={card} actions={{ buttons: [], note: '' }} onChoose={() => {}} onClose={close} zoomable={false} />
      </div>
    </div>
  );
}
