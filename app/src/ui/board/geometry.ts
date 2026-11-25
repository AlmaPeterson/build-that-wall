// Where things are on the board, in stage units, for the two layouts:
//  - wide (computers, phones turned sideways): a 640 × 360 stage, the old game's layout;
//  - tall (phones held upright): a 300 × 600 stage, everything stacked, the hand in rows at the bottom.
// The positions here are the ones the board's CSS uses (board.css, the `html.tall-board` rules for tall);
// the hand, the flying cards and drag-and-drop all read them from here, so they stay in step.
import { createStore } from '../store';

export interface Rect { x: number; y: number; w: number; h: number }
export type DropZone = 'discard' | 'walls';
export type LayoutMode = 'wide' | 'tall';

export interface Geometry {
  /** Stage size in units. */
  stageW: number; stageH: number;
  /** The hand box (board.css .hand), its border, and where cards can go inside it. */
  handBox: Rect; handBorder: number; inner: Rect;
  /** Up to this many rows of cards in the hand. */
  handRows: number;
  /** Where a card dragged out of the hand can be dropped. */
  drop: { zone: DropZone; x: number; y: number; w: number; h: number; label: string }[];
  /** Built walls: yours (x, y; small cards w × h, step apart, squeezed to fit max), others' rows (first row's top, step between rows). */
  mine: { x: number; y: number; w: number; h: number; step: number; max: number };
  none: Rect;
  others: { x: number; y: number; rowStep: number };
  /** For the flying cards. */
  center: Rect; draw: Rect; discard: Rect; jail: Rect; hiddenHand: Rect; handFallback: Rect;
  /** The "limit" / "skip" marks next to a seat's row in Cards in Hand: x, and the first row's y. */
  limit: { x: number; y: number };
}

export const WIDE: Geometry = {
  stageW: 640, stageH: 360,
  handBox: { x: 5, y: 214, w: 464, h: 98 }, handBorder: 1.5, inner: { x: 4, y: 3.5, w: 453, h: 88 }, handRows: 1,
  drop: [
    { zone: 'discard', x: 252, y: 115, w: 50, h: 78, label: 'Play' },
    { zone: 'walls', x: 3, y: 166, w: 196, h: 47, label: 'Build' },
  ],
  mine: { x: 6, y: 171, w: 24, h: 34, step: 27, max: 162 },
  none: { x: 21, y: 181, w: 150, h: 20 },
  others: { x: 308, y: 95, rowStep: 22 },
  center: { x: 266, y: 92, w: 108, h: 150 },
  draw: { x: 208, y: 123.5, w: 44, h: 61 },
  discard: { x: 256, y: 123.5, w: 44, h: 61 },
  jail: { x: 355, y: 76, w: 10, h: 14 },
  hiddenHand: { x: 214, y: 225, w: 46, h: 64 },
  handFallback: { x: 214, y: 222.5, w: 49, h: 67 },
  limit: { x: 170, y: 86.4 },
};

export const TALL: Geometry = {
  stageW: 300, stageH: 600,
  handBox: { x: 4, y: 352, w: 292, h: 196 }, handBorder: 1.5, inner: { x: 4, y: 4, w: 281, h: 185 }, handRows: 4,
  drop: [
    { zone: 'discard', x: 52, y: 186, w: 50, h: 78, label: 'Play' },
    { zone: 'walls', x: 2, y: 286, w: 200, h: 47, label: 'Build' },
  ],
  mine: { x: 6, y: 292, w: 24, h: 34, step: 27, max: 162 },
  none: { x: 20, y: 300, w: 150, h: 20 },
  others: { x: 104, y: 174, rowStep: 22 },
  center: { x: 96, y: 170, w: 108, h: 150 },
  draw: { x: 8, y: 195.5, w: 44, h: 61 },
  discard: { x: 56, y: 195.5, w: 44, h: 61 },
  jail: { x: 161, y: 151, w: 10, h: 14 },
  hiddenHand: { x: 127, y: 410, w: 46, h: 64 },
  handFallback: { x: 120, y: 360, w: 49, h: 67 },
  limit: { x: 278, y: 63.4 },
};

/** Upright screens (clearly taller than wide) get the tall layout. */
export function modeFor(width: number, height: number): LayoutMode {
  return height > width * 1.15 ? 'tall' : 'wide';
}

const detect = (): LayoutMode => (typeof innerWidth === 'number' && typeof innerHeight === 'number' && typeof document !== 'undefined'
  ? modeFor(innerWidth, innerHeight) : 'wide');

/** Which layout the board uses now. `html.tall-board` is set while it's tall, for the CSS. */
export const layoutMode = createStore<LayoutMode>(detect());

function apply(mode: LayoutMode): void {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('tall-board', mode === 'tall');
}
apply(layoutMode.get());
if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
  addEventListener('resize', () => { const m = detect(); if (m !== layoutMode.get()) { layoutMode.set(m); apply(m); } });
}

export const geometry = (): Geometry => (layoutMode.get() === 'tall' ? TALL : WIDE);
