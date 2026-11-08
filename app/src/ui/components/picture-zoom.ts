// Scroll the mouse wheel over a card picture to zoom it in or out around the pointer (e.g. to read the
// small print, or the QR code). Zoomed in, dragging the picture pans it; zoomed all the way out, dragging
// moves the popup as before (components/drag.ts).
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
    const down = (e: PointerEvent) => {
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
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('pointerdown', down); };
  }, []);

  const zoomed = view.z > 1;
  return {
    ref,
    zoomed,
    props: {
      title: 'Scroll to zoom in or out',
      // drag.ts leaves [data-nodrag] alone: zoomed in, dragging pans the picture instead of moving the popup
      'data-nodrag': zoomed ? '' : undefined,
      style: {
        transformOrigin: '0 0',
        transform: zoomed ? `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.z})` : undefined,
        cursor: zoomed ? 'grab' : 'zoom-in',
        zIndex: zoomed ? 1 : undefined,
        touchAction: zoomed ? 'none' : undefined,
      },
    },
  };
}
