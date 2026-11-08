// Scroll the mouse wheel over a card picture, or pinch it with two fingers, to zoom it in or out (e.g. to
// read the small print, or the QR code). Zoomed in, dragging the picture pans it; zoomed all the way out,
// dragging moves the popup as before (components/drag.ts).
import { useEffect, useRef, useState } from 'preact/hooks';

/** z: scale (1 = normal); x, y: where the picture's top-left is, in picture widths/heights from its box. */
export interface View { z: number; x: number; y: number }

export const MAX_ZOOM = 5;
export const NORMAL: View = { z: 1, x: 0, y: 0 };

/** The picture always covers its own box: no gaps at the edges. */
function clamp(v: View): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  if (z === 1) return NORMAL;
  return { z, x: Math.min(0, Math.max(1 - z, v.x)), y: Math.min(0, Math.max(1 - z, v.y)) };
}

/**
 * Zoom by `factor`, keeping the spot under the pointer still. `fx`, `fy`: where the pointer is on the picture
 * as shown, 0..1 across and down.
 */
export function zoomAt(v: View, factor: number, fx: number, fy: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z * factor));
  const px = v.x + fx * v.z, py = v.y + fy * v.z;   // the pointer, in box widths/heights
  return clamp({ z, x: px - fx * z, y: py - fy * z });
}

/** Move a zoomed picture by (dx, dy) box widths/heights. */
export function panBy(v: View, dx: number, dy: number): View {
  return clamp({ ...v, x: v.x + dx, y: v.y + dy });
}

export interface Point { x: number; y: number }

/**
 * One step of a two-finger pinch: the spot between the fingers moved from `m0` to `m1` (in box
 * widths/heights from the box's top-left) and the fingers' distance went from `d0` to `d1`. The picture
 * follows the fingers: it slides with them and grows or shrinks around the spot between them.
 */
export function pinchStep(v: View, m0: Point, d0: number, m1: Point, d1: number): View {
  if (!(d0 > 0) || !(d1 > 0)) return v;
  const moved = { z: v.z, x: v.x + m1.x - m0.x, y: v.y + m1.y - m0.y };
  return zoomAt(moved, d1 / d0, (m1.x - moved.x) / moved.z, (m1.y - moved.y) / moved.z);
}

/** How much one wheel event zooms: a mouse notch is about 1.2x, a trackpad's small steps zoom smoothly. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-150, Math.min(150, px)) * 0.0015);
}

/** Put `ref` on the <img>, and spread `props` on it. `key` resets the zoom when it changes (another card). */
export function usePictureZoom<T extends HTMLElement = HTMLImageElement>(key: unknown) {
  const ref = useRef<T>(null);
  const [view, setView] = useState<View>(NORMAL);
  const current = useRef(view);
  current.current = view;
  useEffect(() => setView(NORMAL), [key]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();   // zoom the picture, not the page
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setView(zoomAt(current.current, wheelFactor(e.deltaY, e.deltaMode), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
    };
    // Fingers on the picture: two of them pinch
    const fingers = new Map<number, Point>();
    const pinch = (e: PointerEvent) => {
      const first = [...fingers.keys()];
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Stop what the first finger started (drag.ts moving the popup, or panning below): both fingers pinch now
      for (const id of first) dispatchEvent(new PointerEvent('pointercancel', { pointerId: id }));
      // The picture's box on screen (it doesn't move while pinching), from the picture as shown now
      const r = el.getBoundingClientRect(), v0 = current.current;
      const w = r.width / v0.z, h = r.height / v0.z, left = r.left - v0.x * w, top = r.top - v0.y * h;
      const shape = () => {
        const [a, b] = [...fingers.values()] as [Point, Point];
        return { m: { x: ((a.x + b.x) / 2 - left) / w, y: ((a.y + b.y) / 2 - top) / h }, d: Math.hypot(a.x - b.x, a.y - b.y) };
      };
      let last = shape();
      const move = (m: PointerEvent) => {
        if (!fingers.has(m.pointerId)) return;
        m.preventDefault();
        fingers.set(m.pointerId, { x: m.clientX, y: m.clientY });
        const now = shape();
        const from = last;
        setView(v => pinchStep(v, from.m, from.d, now.m, now.d));
        last = now;
      };
      const up = (u: PointerEvent) => {
        if (!fingers.has(u.pointerId)) return;
        fingers.clear();
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        // Lifting the fingers isn't a tap or a double-tap on the card
        const eat = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
        addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', eat, { capture: true }), 300);
      };
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    const forget = (e: PointerEvent) => { if (fingers.size < 2) fingers.delete(e.pointerId); };
    addEventListener('pointerup', forget);
    addEventListener('pointercancel', forget);

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (fingers.size >= 2) return;
        if (fingers.size === 1) { e.preventDefault(); e.stopPropagation(); pinch(e); return; }
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (e.button !== 0 || current.current.z === 1) return;   // not zoomed: drag.ts moves the popup
      e.preventDefault();
      const r = el.getBoundingClientRect(), z = current.current.z;
      const w = r.width / z, h = r.height / z;   // the box's size on screen
      let lx = e.clientX, ly = e.clientY;
      const move = (m: PointerEvent) => {
        if (m.pointerId !== e.pointerId) return;
        setView(v => panBy(v, (m.clientX - lx) / w, (m.clientY - ly) / h));
        lx = m.clientX; ly = m.clientY;
      };
      const up = (u: PointerEvent) => {
        if (u.pointerId !== e.pointerId) return;
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', down);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', down);
      removeEventListener('pointerup', forget);
      removeEventListener('pointercancel', forget);
    };
  }, []);

  const zoomed = view.z > 1;
  return {
    ref,
    zoomed,
    props: {
      title: 'Scroll or pinch to zoom in or out',
      // drag.ts leaves [data-nodrag] alone: zoomed in, dragging pans the picture instead of moving the popup
      'data-nodrag': zoomed ? '' : undefined,
      style: {
        transformOrigin: '0 0',
        transform: zoomed ? `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.z})` : undefined,
        cursor: zoomed ? 'grab' : 'zoom-in',
        zIndex: zoomed ? 1 : undefined,
        touchAction: 'none',   // a pinch zooms the picture, not the whole page
      },
    },
  };
}
