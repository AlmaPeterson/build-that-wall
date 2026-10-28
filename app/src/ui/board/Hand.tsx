// The viewer's hand: a scrollable row of cards (the old Hand Scrollbar). While picking walls, only the
// cards that can be picked are clickable. Cards can be dragged to arrange them (hand-order.ts): with a
// mouse, just drag; on a touch screen, hold a card for a moment, then drag. Alt+←/→ moves a focused card.
import { cardById, type CardId } from '../../data/cards';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Seat } from '../../game';
import { useStore } from '../store';
import { displayOrder, handOrderVersion, moveCard } from './hand-order';
import { HAND_WIDTH_UNITS, setHandScroll } from '../anim/layout';
import { cardImage } from '../assets';

export interface HandPicking {
  pickable: number[];   // slots that can be picked
  picked: number[];
}

interface Props {
  /** Whose hand it is (each player's arrangement is kept separately). */
  seat: Seat;
  cards: readonly CardId[];
  onCard(slot: number): void;
  picking?: HandPicking | null;
  /**
   * A card pulled up out of the hand follows the pointer around the board (to drop it on the discard pile or
   * your walls): called as it moves ('move'), when it's let go ('drop') and if the drag is cut off ('cancel').
   * x, y are viewport pixels. Without it, cards only move along the hand.
   */
  onLift?(slot: number, x: number, y: number, phase: 'move' | 'drop' | 'cancel'): void;
  /** Whose hand it says it is: "Your Hand" unless it's someone else's (a bots-only game). */
  title?: string;
}

const DRAG_START_PX = 6;      // a mouse press that moves further than this is a drag, not a tap
const TOUCH_HOLD_MS = 250;    // on a touch screen, hold this long before dragging (a quick swipe scrolls)
const EDGE_PX = 24;           // dragging near either end scrolls the hand
const LIFT_PX = 30;           // pulling a card this far up takes it out of the hand

interface Drag { from: number; to: number; dx: number }

export function Hand({ seat, cards, onCard, picking, onLift, title = 'Your Hand' }: Props) {
  const row = useRef<HTMLDivElement>(null);
  useStore(handOrderVersion);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragNow = useRef<Drag | null>(null);           // the latest, for pointerup (state may not have re-rendered yet)
  const setDrag = (d: Drag | null) => { dragNow.current = d; setDragState(d); };
  const press = useRef<{ x: number; y: number; from: number; id: number; active: boolean; free: boolean; scroll0: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const [lifted, setLifted] = useState<number | null>(null);
  const swallowClick = useRef(false);
  const order = displayOrder(seat, cards);
  /** Width of one card plus the gap, in pixels. */
  const pitch = () => ((row.current?.offsetWidth || HAND_WIDTH_UNITS) / HAND_WIDTH_UNITS) * 60;

  // While a card is being dragged with a finger, the hand mustn't scroll instead
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const touch = (e: TouchEvent) => { if (press.current?.active) e.preventDefault(); };
    el.addEventListener('touchmove', touch, { passive: false });
    return () => el.removeEventListener('touchmove', touch);
  }, []);

  function down(e: PointerEvent, from: number) {
    if (picking || e.button > 0) return;
    const p = { x: e.clientX, y: e.clientY, from, id: e.pointerId, active: false, free: false, scroll0: row.current?.scrollLeft ?? 0 } as NonNullable<typeof press.current>;
    if (e.pointerType === 'touch') {
      p.timer = setTimeout(() => {
        p.active = true;
        try { navigator.vibrate?.(15); } catch { /* not supported */ }
        setDrag({ from, to: from, dx: 0 });
      }, TOUCH_HOLD_MS);
    }
    press.current = p;
  }

  function move(e: PointerEvent) {
    const p = press.current, el = row.current;
    if (!p || e.pointerId !== p.id || !el) return;
    const dx0 = e.clientX - p.x, dy0 = e.clientY - p.y;
    if (!p.active) {
      if (e.pointerType === 'touch') { if (Math.hypot(dx0, dy0) > DRAG_START_PX) { clearTimeout(p.timer); press.current = null; } return; }
      if (Math.hypot(dx0, dy0) < DRAG_START_PX) return;
      p.active = true;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    // Pulled up out of the hand: it follows the pointer around the board
    if (!p.free && onLift && -dy0 > LIFT_PX && -dy0 > Math.abs(dx0)) {
      p.free = true;
      setDrag(null);
      setLifted(order[p.from]!);
    }
    if (p.free) { onLift?.(order[p.from]!, e.clientX, e.clientY, 'move'); return; }
    const box = el.getBoundingClientRect();
    if (e.clientX < box.left + EDGE_PX) el.scrollLeft -= 8;
    else if (e.clientX > box.right - EDGE_PX) el.scrollLeft += 8;
    const dx = dx0 + (el.scrollLeft - p.scroll0);
    const to = Math.max(0, Math.min(order.length - 1, p.from + Math.round(dx / pitch())));
    setDrag({ from: p.from, to, dx });
  }

  function up(e: PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.timer);
    press.current = null;
    if (p.free) {
      swallowClick.current = true;
      setLifted(null);
      onLift?.(order[p.from]!, e.clientX, e.clientY, e.type === 'pointercancel' ? 'cancel' : 'drop');
      return;
    }
    if (p.active) {
      swallowClick.current = true;                         // the click that follows a drag isn't a tap
      const d = dragNow.current;
      if (d) moveCard(seat, cards, d.from, d.to);
    }
    setDrag(null);
  }

  function key(e: KeyboardEvent, at: number) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const to = at + (e.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    moveCard(seat, cards, at, to);
    requestAnimationFrame(() => row.current?.querySelectorAll<HTMLElement>('.hand__card')[to]?.focus());
  }

  // While dragging, the other cards make room where the card would go
  const shown = [...order];
  if (drag) shown.splice(drag.to, 0, shown.splice(drag.from, 1)[0]!);
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
      <div class="at hand__title">{title}</div>
      <div class={'at hand' + (drag ? ' hand--dragging' : '')} role="list" aria-label={title + ' (drag cards to arrange them)'} ref={row}>
        {shown.map((slot, at) => {
          const id = cards[slot]!;
          const pickable = picking ? picking.pickable.includes(slot) : true;
          const picked = picking?.picked.includes(slot) ?? false;
          const dragging = drag !== null && order[drag.from] === slot;
          const cls = ['hand__card', picking && pickable && !picked ? 'hand__card--pickable' : '', picked ? 'hand__card--picked' : '',
            picking && !pickable ? 'hand__card--dim' : '', dragging ? 'hand__card--dragging' : '', lifted === slot ? 'hand__card--lifted' : ''].join(' ');
          return (
            <button type="button" role="listitem" class={cls} key={slot} disabled={!pickable} data-slot={slot}
              // the dragged card follows the pointer from wherever it has been put in the row
              style={dragging ? { transform: `translateX(${drag.dx - (drag.to - drag.from) * pitch()}px)` } : undefined}
              aria-pressed={picking ? picked : undefined} title={cardById(id).name + (picking ? '' : ' (drag to move it)')}
              onPointerDown={e => down(e, order.indexOf(slot))} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onKeyDown={e => key(e, at)}
              onClick={() => { if (swallowClick.current) { swallowClick.current = false; return; } onCard(slot); }}>
              <img src={cardImage(id, 'thumb')} alt={cardById(id).name} draggable={false} />
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Shown instead of the hand while a bot plays (and in watch mode). What the bot plays is shown flying across the board. */
export function HiddenHand({ message = 'Hands are hidden while the computer plays' }: { message?: string }) {
  return (
    <>
      <div class="at hand__title">Your Hand</div>
      <div class="at hand__hidden" aria-live="polite">
        <span>{message}</span>
      </div>
    </>
  );
}
