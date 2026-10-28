// Popups that can be dragged aside, and made smaller, to see the board behind them. Drag anywhere on the
// box except its buttons; a short move still counts as a tap. The corner grip (<ResizeGrip />) scales the
// whole box from its top-left corner. Each kind of popup remembers where it was left and its size (until
// the page closes), so the next one opens the same way.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Offset { x: number; y: number }
interface Placed extends Offset { s: number }   // s: scale, 1 = normal size

const START_PX = 6;     // moves shorter than this are taps
const KEEP_PX = 48;     // this much of the box always stays inside what's behind it (the board, or the window)
export const MIN_SCALE = 0.4, MAX_SCALE = 1.5;
const placed = new Map<string, Placed>();

/**
 * The new scale when the grip (at `grip`, the box's top-left corner at `corner`) is dragged by (dx, dy):
 * the grip follows the pointer along the line from the corner.
 */
export function scaleFor(s: number, corner: Offset, grip: Offset, dx: number, dy: number): number {
  const vx = grip.x - corner.x, vy = grip.y - corner.y, len = vx * vx + vy * vy;
  if (len <= 0) return s;
  const k = ((vx + dx) * vx + (vy + dy) * vy) / len;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * k * 100) / 100));
}

/** Not a drag handle: controls, and lists that scroll (on touch, so they still scroll). */
function ignore(target: EventTarget | null, touch: boolean): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest('button, a, input, select, textarea, [data-nodrag]')) return true;
  if (!touch) return false;
  for (let e: Element | null = target; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return true;
  }
  return false;
}

interface Rect { left: number; top: number; right: number; bottom: number }

/** Keeps `KEEP_PX` of a box (whose rect at offset `from` is `r`) inside `area`. */
export function clampOffset(o: Offset, from: Offset, r: Rect, area: Rect): Offset {
  const dx = o.x - from.x, dy = o.y - from.y;
  const x = Math.min(Math.max(dx, area.left + KEEP_PX - r.right), area.right - KEEP_PX - r.left);
  const y = Math.min(Math.max(dy, area.top - r.top), area.bottom - KEEP_PX - r.top);   // the top edge stays inside
  return { x: from.x + x, y: from.y + y };
}

/**
 * What's seen of the box: its own rect, or with data-drag-children (a full-size layer holding separate
 * pieces, like the card popup's picture, text and buttons) the rect around its pieces.
 */
function shownRect(el: HTMLElement): Rect {
  if (el.dataset.dragChildren === undefined) return el.getBoundingClientRect();
  const rs = [...el.children].map(c => c.getBoundingClientRect()).filter(r => r.width || r.height);
  if (!rs.length) return el.getBoundingClientRect();
  return {
    left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)),
    right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)),
  };
}

/** Where the box may go: its backdrop (the board for board popups, which clips what's outside it), within the window. */
function areaFor(el: HTMLElement): Rect {
  const p = el.parentElement?.getBoundingClientRect();
  return {
    left: Math.max(0, p?.left ?? 0), top: Math.max(0, p?.top ?? 0),
    right: Math.min(innerWidth, p?.right ?? innerWidth), bottom: Math.min(innerHeight, p?.bottom ?? innerHeight),
  };
}

/** Put `ref` on the box and `style` on the same element; `moved` once it's been dragged off centre. */
export function useDraggable<T extends HTMLElement = HTMLDivElement>(kind: string) {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState<Placed>(() => placed.get(kind) ?? { x: 0, y: 0, s: 1 });
  const current = useRef(offset);
  current.current = offset;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Opened where the last one was left: pull it back on screen if the window has shrunk since
    const fixed = clampOffset(current.current, current.current, shownRect(el), areaFor(el));
    if (fixed.x !== current.current.x || fixed.y !== current.current.y) setOffset({ ...current.current, ...fixed });

    const down = (e: PointerEvent) => {
      const grip = e.target instanceof Element ? e.target.closest('.drag-grip') : null;
      if (e.button !== 0 || (!grip && ignore(e.target, e.pointerType !== 'mouse'))) return;
      const sx = e.clientX, sy = e.clientY, from = current.current, rect = shownRect(el), area = areaFor(el);
      const g = grip?.getBoundingClientRect();
      const gripAt = g ? { x: g.left + g.width / 2, y: g.top + g.height / 2 } : null;
      let dragging = !!grip;
      if (grip) e.preventDefault();
      const move = (m: PointerEvent) => {
        if (m.pointerId !== e.pointerId) return;
        const dx = m.clientX - sx, dy = m.clientY - sy;
        if (!dragging && Math.hypot(dx, dy) < START_PX) return;
        dragging = true;
        m.preventDefault();
        if (gripAt) setOffset({ ...from, s: scaleFor(from.s, { x: rect.left, y: rect.top }, gripAt, dx, dy) });
        else setOffset({ ...clampOffset({ x: from.x + dx, y: from.y + dy }, from, rect, area), s: from.s });
      };
      const up = (u: PointerEvent) => {
        if (u.pointerId !== e.pointerId) return;
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!dragging) return;
        placed.set(kind, current.current);
        // The release isn't a click: don't zoom a card or close the popup
        const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
        addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', eat, { capture: true }), 0);
      };
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  }, [kind]);

  // Saved as it moves too, so a popup that closes mid-drag (its question answered elsewhere) is remembered
  useEffect(() => { if (offset.x || offset.y || offset.s !== 1) placed.set(kind, offset); }, [kind, offset]);

  const moved = offset.x !== 0 || offset.y !== 0 || offset.s !== 1;
  return {
    ref,
    style: { transform: moved ? `translate(${offset.x}px, ${offset.y}px) scale(${offset.s})` : undefined },
    moved,
  };
}

/** Forget where popups were left (tests). */
export function resetDragPositions(): void { placed.clear(); }

/** The corner grip that resizes a draggable box: put it inside the box, at its bottom-right corner. */
export const RESIZE_TITLE = 'Drag to make this smaller or bigger';
