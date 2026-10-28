// Where each Place is on the 640×360 stage, in stage units. Mirrors the positions in board/board.css
// and board/Walls.tsx; keep them in step when the board layout changes.
import type { GameState, Seat } from '../../game';
import { wallKinds } from '../board/board-state';
import type { Place } from './moves';

export interface Rect { x: number; y: number; w: number; h: number }

/** Who is shown where: `mine` has the walls under the scoreboard (-1 = nobody), `hand` the hand at the bottom. */
export interface Seating { mine: Seat; hand: Seat | null }

export const CENTER: Rect = { x: 266, y: 92, w: 108, h: 150 };
const DRAW: Rect = { x: 208, y: 123.5, w: 44, h: 61 };
const DISCARD: Rect = { x: 256, y: 123.5, w: 44, h: 61 };
const JAIL: Rect = { x: 355, y: 76, w: 10, h: 14 };
const HIDDEN_HAND: Rect = { x: 214, y: 225, w: 46, h: 64 };
const HAND_RIGHT = 469 - 49;

function rowOf(view: GameState, seating: Seating, seat: Seat): number {
  return view.seats.map((_, s) => s).filter(s => s !== seating.mine).indexOf(seat);
}

/** Wall `kind` of `seat`: where its small card is (or would be, if it's the first of its kind). */
function wallRect(view: GameState, seating: Seating, seat: Seat, kind: number): Rect {
  const kinds = wallKinds(view, seat).map(k => k.kind);
  if (!kinds.includes(kind)) kinds.push(kind), kinds.sort((a, b) => a - b);
  const i = kinds.indexOf(kind), n = kinds.length;
  const mine = seat === seating.mine;
  const step = mine ? 27 : 17, max = mine ? 162 : 120;
  const gap = n > 1 && step * (n - 1) > max ? max / (n - 1) : step;
  if (mine) return { x: 6 + i * gap, y: 171, w: 24, h: 34 };
  return { x: 338 + i * gap, y: 95.5 + rowOf(view, seating, seat) * 22, w: 15, h: 21 };
}

/** "At that player": their row of walls on the right, or your own walls / hand. */
export function seatRect(view: GameState, seating: Seating, seat: Seat): Rect {
  if (seat === seating.hand) return { x: 214, y: 222.5, w: 49, h: 67 };
  if (seat === seating.mine) return { x: 60, y: 171, w: 24, h: 34 };
  return { x: 312, y: 96 + rowOf(view, seating, seat) * 22, w: 15, h: 21 };
}

export function placeRect(place: Place, view: GameState, seating: Seating): Rect {
  switch (place.at) {
    case 'hand':
      if (place.seat === seating.hand) return { x: Math.min(11.5 + place.slot * 60, HAND_RIGHT), y: 222.5, w: 49, h: 67 };
      if (place.seat === seating.mine) return HIDDEN_HAND;
      return seatRect(view, seating, place.seat);
    case 'walls': return wallRect(view, seating, place.seat, place.kind);
    case 'guard': {
      const r = wallRect(view, seating, place.seat, place.kind);
      return { x: r.x + r.w * 0.55, y: r.y - 3, w: r.w * 0.45, h: r.h * 0.45 };
    }
    case 'limit': return { x: 170, y: 86.4 + place.seat * 12.945, w: 9, h: 12 };
    case 'seat': return seatRect(view, seating, place.seat);
    case 'draw': return DRAW;
    case 'discard': return DISCARD;
    case 'jail': return JAIL;
    case 'center': return CENTER;
  }
}
