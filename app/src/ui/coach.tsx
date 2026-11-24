// The first-game coach: four short, visual steps over the board in a tutorial game. Each step dims the board
// and lights up one part (your cards, your walls, the miles, End Turn) with a bubble that says what it's for.
// Next / Skip / Let's play! There's always a Skip, and the game carries on underneath as normal.
import { useEffect, useState } from 'preact/hooks';
import { createStore, useStore } from './store';
import './coach.css';

export interface CoachStep { icon: string; title: string; text: string; target: string }

export const COACH_STEPS: CoachStep[] = [
  { icon: '🃏', title: 'Your cards', text: 'Tap a card to see what it does, then play it.', target: '.hand' },
  { icon: '🧱', title: 'Build your wall', text: 'Wall Section cards build walls. Pay with a Man Hour, or with 2 other wall cards.', target: '.walls-mine, .walls-none' },
  { icon: '🏆', title: 'Score miles', text: 'Matching walls are worth more: 1 = 3 miles, 2 = 8, 3 = 16. Most miles wins!', target: '.score--miles' },
  { icon: '⏭️', title: '3 actions a turn', text: 'Build or play up to 3 times, then press End Turn.', target: '.side__end-turn' },
];

/** Which step is showing (0-3), or null when the coach is off. */
export const coach = createStore<number | null>(null);

export const startCoach = () => coach.set(0);
export const nextCoach = () => { const s = coach.get(); coach.set(s === null || s >= COACH_STEPS.length - 1 ? null : s + 1); };
export const skipCoach = () => coach.set(null);

interface Box { x: number; y: number; w: number; h: number }
const PAD = 6;

/** Where the step's part of the board is on screen; null until it's there. */
function find(selector: string): Box | null {
  const el = typeof document !== 'undefined' ? document.querySelector(selector) : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 } : null;
}

export function Coach() {
  const step = useStore(coach);
  const [box, setBox] = useState<Box | null>(null);
  // Follow the part of the board as it appears, moves or the window changes size
  useEffect(() => {
    if (step === null) return;
    const target = COACH_STEPS[step]!.target;
    // Waits while something else asks first ("Your turn", pass the device, a card shown big...)
    const update = () => setBox(document.querySelector('[aria-modal="true"]') ? null : find(target) ?? find('.stage'));
    update();
    const t = setInterval(update, 400);
    addEventListener('resize', update);
    return () => { clearInterval(t); removeEventListener('resize', update); };
  }, [step]);
  if (step === null || !box) return null;
  const s = COACH_STEPS[step]!, last = step === COACH_STEPS.length - 1;
  // The bubble goes below the lit part if there's room, otherwise above it; kept on screen
  const vw = typeof innerWidth === 'number' ? innerWidth : 1280, vh = typeof innerHeight === 'number' ? innerHeight : 720;
  const bw = Math.min(360, vw - 24);
  const below = box.y + box.h + 12 + 190 < vh;
  const left = Math.max(12, Math.min(vw - bw - 12, box.x + box.w / 2 - bw / 2));
  const top = below ? box.y + box.h + 12 : undefined, bottom = below ? undefined : vh - box.y + 12;
  return (
    <div class="coach" role="dialog" aria-label={'Quick guide, step ' + (step + 1) + ' of ' + COACH_STEPS.length + ': ' + s.title}>
      <div class="coach__spot" style={{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }} />
      <div class="coach__bubble" style={{ left: left + 'px', width: bw + 'px', ...(top !== undefined ? { top: top + 'px' } : { bottom: bottom + 'px' }) }}>
        <div class="coach__head"><span class="coach__icon" aria-hidden="true">{s.icon}</span><b>{s.title}</b></div>
        <p class="coach__text">{s.text}</p>
        <div class="coach__foot">
          <span class="coach__dots" aria-hidden="true">{COACH_STEPS.map((_, i) => <i key={i} class={i === step ? 'is-on' : ''} />)}</span>
          {!last && <button type="button" class="coach__skip" onClick={skipCoach}>Skip</button>}
          <button type="button" class="coach__next" onClick={nextCoach} autoFocus>{last ? "Let's play!" : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
