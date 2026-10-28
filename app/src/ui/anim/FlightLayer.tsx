// Draws the animator's flying cards over the board with the Web Animations API, and the caption for a
// played card. Tapping anywhere while cards are moving finishes the step.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { CardPopup } from '../board/CardPopup';
import { showCard, zoomedCard } from '../components/zoom';
import { cardById } from '../../data/cards';
import { CARD_BACK_IMAGE, cardImage } from '../assets';
import { useStore } from '../store';
import type { Animator, Flight } from './animator';
import './anim.css';

function FlyingCard({ flight, duration, unit, paused, onOpen }: { flight: Flight; duration: number; unit: number; paused: boolean; onOpen(): void }) {
  const box = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const el = box.current, face = front.current;
    if (!el || duration <= 0 || typeof el.animate !== 'function') return;
    const offset = (t: number) => Math.min(1, t / duration);
    const frames = flight.keys.map(k => ({
      offset: offset(k.t),
      transform: `translate(${k.x * unit}px, ${k.y * unit}px)`,
      width: `${k.w * unit}px`, height: `${k.h * unit}px`,
      easing: 'ease-in-out',
    }));
    if (frames.at(-1)!.offset < 1) frames.push({ ...frames.at(-1)!, offset: 1 });
    const faces = flight.keys.map(k => ({ offset: offset(k.t), opacity: k.face ? 1 : 0, easing: 'steps(1, end)' }));
    if (faces.at(-1)!.offset < 1) faces.push({ ...faces.at(-1)!, offset: 1 });
    const a = el.animate(frames, { duration, fill: 'forwards' });
    const b = face?.animate(faces, { duration, fill: 'forwards' });
    // Cancelling rejects `finished`; nothing waits on it
    a.finished.catch(() => {}); b?.finished.catch(() => {});
    anims.current = b ? [a, b] : [a];
    return () => { a.cancel(); b?.cancel(); anims.current = []; };
  }, [flight, duration, unit]);
  useEffect(() => { for (const a of anims.current) { if (paused) a.pause(); else a.play(); } }, [paused]);
  const k = flight.keys[0]!;
  const back = flight.card === 4;
  return (
    <div ref={box} class={'flight' + (flight.big ? ' flight--big' : '')} style={{ transform: `translate(${k.x * unit}px, ${k.y * unit}px)`, width: `${k.w * unit}px`, height: `${k.h * unit}px` }}
      onClick={flight.big && !back ? e => { e.stopPropagation(); onOpen(); } : undefined}
      title={flight.big && !back ? 'Tap to read this card' : undefined}>
      <img src={CARD_BACK_IMAGE()} alt="" draggable={false} />
      {!back && (
        <div ref={front} class="flight__face" style={{ opacity: k.face ? 1 : 0 }}>
          <img src={cardImage(flight.card, 'thumb')} alt={cardById(flight.card).name} draggable={false} />
          {/* Sharp in the middle: the high-quality picture covers the thumbnail once it has loaded */}
          {flight.big && <img src={cardImage(flight.card, 'high')} alt="" draggable={false} />}
        </div>
      )}
    </div>
  );
}

export function FlightLayer({ animator }: { animator: Animator }) {
  const { flights, duration, caption, target, held, confirm, paused } = useStore(animator.state);
  const layer = useRef<HTMLDivElement>(null);
  const unit = (layer.current?.parentElement?.clientWidth ?? 640) / 640;
  // A card opened full size from the middle pauses the game until it's closed
  useEffect(() => zoomedCard.subscribe(c => { if (c === null) animator.resume(); }), [animator]);
  const open = (card: number) => { animator.pause(); showCard(card); };
  if (!flights.length) {
    // A card waiting halfway to the player it was played on (they're deciding whether to block it)
    return (
      <div ref={layer} class="flights flights--idle">
        {held && <img class="flight flight--held" src={cardImage(held.card, 'thumb')} alt={cardById(held.card).name}
          style={{ transform: `translate(${held.rect.x * unit}px, ${held.rect.y * unit}px)`, width: `${held.rect.w * unit}px`, height: `${held.rect.h * unit}px` }} />}
      </div>
    );
  }
  return (
    <div ref={layer} class={'flights' + (paused ? ' flights--paused' : '')} onClick={() => { if (!confirm) animator.skip(); }} title={confirm ? undefined : 'Tap to skip'}>
      {target && <div class="flights__target" style={{ left: `${target.x * unit}px`, top: `${target.y * unit}px`, width: `${target.w * unit}px`, height: `${target.h * unit}px`, animationDuration: `${duration}ms` }} />}
      {caption && <div class="flights__caption" role="status" aria-live="polite">{caption}</div>}
      {flights.map(f => <FlyingCard key={f.id} flight={f} duration={duration} unit={unit} paused={paused} onOpen={() => open(f.card)} />)}
      {confirm && (
        <CardPopup card={confirm.card} closeLabel="Continue" onChoose={() => {}} onClose={() => animator.continue()}
          actions={{ buttons: [], note: `PLAY IMMEDIATELY: ${confirm.text.replace(/^PLAY IMMEDIATELY: /, '')} It happens as soon as it's drawn.` }} />
      )}
    </div>
  );
}
