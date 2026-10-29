// A card shown full size with its text, over everything (board, prompts, pass screen). Opened by tapping
// any face-up card, or double/right-clicking one whose tap does something else (components/zoom.ts).
// Zoom In shows just the picture as big as the window; Scan QR Code opens the page the card's QR code links to.
import { useEffect, useState } from 'preact/hooks';
import { cardById } from '../../data/cards';
import { cardImage } from '../assets';
import { Button } from '../components/Button';
import { zoomedCard } from '../components/zoom';
import { useStore } from '../store';
import { CardPopup } from './CardPopup';
import './board.css';

export function CardZoom() {
  const card = useStore(zoomedCard);
  const [big, setBig] = useState(false);
  useEffect(() => setBig(false), [card]);
  useEffect(() => {
    if (!big) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setBig(false); } };
    addEventListener('keydown', key, { capture: true });
    return () => removeEventListener('keydown', key, { capture: true });
  }, [big]);
  if (card === null) return null;
  const close = () => zoomedCard.set(null);
  const c = cardById(card);
  if (big) {
    return (
      <div class="card-zoom card-zoom--big" role="dialog" aria-modal="true" aria-label={c.name + ', zoomed in'}
        onClick={e => { if (e.target === e.currentTarget) setBig(false); }}>
        <img class="card-zoom__big" src={cardImage(card, 'high')} alt={c.name} draggable={false} onClick={() => setBig(false)} />
        <div class="card-zoom__bar">
          <Button onClick={() => setBig(false)}>Zoom Out</Button>
          {c.link && <Button onClick={() => openLink(c.link!)}>Scan QR Code</Button>}
          <Button color="plain" onClick={close}>Close</Button>
        </div>
      </div>
    );
  }
  return (
    <div class="card-zoom" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div class="stage card-zoom__stage">
        <CardPopup card={card} actions={{ buttons: [], note: '' }} onChoose={() => {}} onClose={close} zoomable={false}
          extra={<>
            <Button onClick={() => setBig(true)}>Zoom In</Button>
            {c.link && <Button onClick={() => openLink(c.link!)} title="Opens the page this card's QR code links to">Scan QR Code</Button>}
          </>} />
      </div>
    </div>
  );
}

function openLink(url: string): void {
  try { window.open(url, '_blank', 'noopener'); } catch { /* blocked */ }
}
