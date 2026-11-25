// Where each Place is on the stage, in stage units, for the layout in use (board/geometry.ts: wide 640 × 360
// or tall 300 × 600). Mirrors the positions in board/board.css and board/Walls.tsx.
import type { GameState, Seat } from '../../game';
import { wallKinds } from '../board/board-state';
import { handLayout } from '../board/hand-layout';
import { geometry, WIDE } from '../board/geometry';
import type { Place } from './moves';
import { OTHER_WALLS_LEFT, OTHER_WALLS_MAX } from '../board/Walls';

export interface Rect { x: number; y: number; w: number; h: number }

/** Who is shown where: `mine` has the walls under the scoreboard (-1 = nobody), `hand` the hand at the bottom. */
export interface Seating { mine: Seat; hand: Seat | null }

/** The middle of the wide stage (geometry().center is the one in use now). */
export const CENTER: Rect = WIDE.center;

function rowOf(view: GameState, seating: Seating, seat: Seat): number {
  return view.seats.map((_, s) => s).filter(s => s !== seating.mine).indexOf(seat);
}

/** Wall `kind` of `seat`: where its small card is (or would be, if it's the first of its kind). */
function wallRect(view: GameState, seating: Seating, seat: Seat, kind: number): Rect {
  const kinds = wallKinds(view, seat).map(k => k.kind);
  if (!kinds.includes(kind)) kinds.push(kind), kinds.sort((a, b) => a - b);
  const i = kinds.indexOf(kind), n = kinds.length;
  const mine = seat === seating.mine, g = geometry();
  const step = mine ? g.mine.step : 17, max = mine ? g.mine.max : OTHER_WALLS_MAX;
  const gap = n > 1 && step * (n - 1) > max ? max / (n - 1) : step;
  if (mine) return { x: g.mine.x + i * gap, y: g.mine.y, w: g.mine.w, h: g.mine.h };
  return { x: g.others.x + OTHER_WALLS_LEFT + i * gap, y: g.others.y + 0.5 + rowOf(view, seating, seat) * g.others.rowStep, w: 15, h: 21 };
}

/** "At that player": their row of walls on the right, or your own walls / hand. */
export function seatRect(view: GameState, seating: Seating, seat: Seat): Rect {
  const g = geometry();
  if (seat === seating.hand) return g.handFallback;
  if (seat === seating.mine) return { x: g.mine.x + 54, y: g.mine.y, w: g.mine.w, h: g.mine.h };
  return { x: g.others.x + 4, y: g.others.y + 1 + rowOf(view, seating, seat) * g.others.rowStep, w: 15, h: 21 };
}

export function placeRect(place: Place, view: GameState, seating: Seating): Rect {
  switch (place.at) {
    case 'hand':
      if (place.seat === seating.hand) {
        // Where that card is shown in the sorted, stacked hand (board/hand-layout.ts)
        const at = handLayout(view.seats[place.seat]?.hand ?? [])[place.slot], g = geometry();
        if (at) return { x: g.handBox.x + g.handBorder + at.x, y: g.handBox.y + g.handBorder + at.y, w: at.w, h: at.h };
        return g.handFallback;
      }
      if (place.seat === seating.mine) return geometry().hiddenHand;
      return seatRect(view, seating, place.seat);
    case 'walls': return wallRect(view, seating, place.seat, place.kind);
    case 'guard': {
      const r = wallRect(view, seating, place.seat, place.kind);
      return { x: r.x + r.w * 0.55, y: r.y - 3, w: r.w * 0.45, h: r.h * 0.45 };
    }
    case 'limit': case 'skip': { const l = geometry().limit; return { x: l.x, y: l.y + place.seat * 12.945, w: 9, h: 12 }; }
    case 'seat': return seatRect(view, seating, place.seat);
    case 'draw': return geometry().draw;
    case 'discard': return geometry().discard;
    case 'jail': return geometry().jail;
    case 'center': return geometry().center;
  }
}
