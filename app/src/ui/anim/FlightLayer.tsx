// Draws the animator's flying cards over the board with the Web Animations API, and the caption for a
// played card. Tapping anywhere while cards are moving finishes the step.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { cardById } from '../../data/cards';
import { CARD_BACK_IMAGE, cardImage } from '../assets';
import { useStore } from '../store';
import type { Animator, Flight } from './animator';
import './anim.css';

function FlyingCard({ flight, duration, unit }: { flight: Flight; duration: number; unit: number }) {
  const box = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLImageElement>(null);
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
    return () => { a.cancel(); b?.cancel(); };
  }, [flight, duration, unit]);
  const k = flight.keys[0]!;
  const back = flight.card === 4;
  return (
    <div ref={box} class="flight" style={{ transform: `translate(${k.x * unit}px, ${k.y * unit}px)`, width: `${k.w * unit}px`, height: `${k.h * unit}px` }}>
      <img src={CARD_BACK_IMAGE()} alt="" draggable={false} />
      {!back && <img ref={front} class="flight__face" src={cardImage(flight.card, 'thumb')} alt={cardById(flight.card).name}
        style={{ opacity: k.face ? 1 : 0 }} draggable={false} />}
    </div>
  );
}

export function FlightLayer({ animator }: { animator: Animator }) {
  const { flights, duration, caption, target } = useStore(animator.state);
  const layer = useRef<HTMLDivElement>(null);
  const unit = (layer.current?.parentElement?.clientWidth ?? 640) / 640;
  if (!flights.length) return <div ref={layer} class="flights flights--idle" />;
  return (
    <div ref={layer} class="flights" onClick={() => animator.skip()} title="Tap to skip">
      {target && <div class="flights__target" style={{ left: `${target.x * unit}px`, top: `${target.y * unit}px`, width: `${target.w * unit}px`, height: `${target.h * unit}px`, animationDuration: `${duration}ms` }} />}
      {caption && <div class="flights__caption" role="status" aria-live="polite">{caption}</div>}
      {flights.map(f => <FlyingCard key={f.id} flight={f} duration={duration} unit={unit} />)}
    </div>
  );
}
