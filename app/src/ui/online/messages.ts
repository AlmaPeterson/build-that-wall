// What the TypeScript game sends inside the room's data messages (services/online, t: 'x').
// The host runs the game; each player only ever receives their own view of it.
import type { Action, ActionResult, Answer, Decision, GameEvent, GameState, Seat } from '../../game';

export type ToHost =
  | { k: 'name'; name: string }                                   // a player's name, sent after joining
  | { k: 'act'; id: number; action: Action }                      // an action on this player's turn
  | { k: 'resync' };                                              // missed a snapshot: send everything again

export type ToPlayer =
  | { k: 'lobby'; players: LobbyPlayer[]; bots: number }          // broadcast while waiting to start
  | { k: 'snap'; seat: Seat; view: GameState; events: GameEvent[]; from: number; total: number }
  | { k: 'result'; id: number; result: ActionResult };

export interface LobbyPlayer { seat: number; name: string }      // room seat (1 = host)

/** Decisions travel through the room's ask/answer with this mode; l1 holds the decision as JSON. */
export const ASK_MODE = 'btw2';

export function isToHost(d: unknown): d is ToHost {
  return !!d && typeof d === 'object' && ['name', 'act', 'resync'].includes((d as { k?: string }).k ?? '');
}

export function isToPlayer(d: unknown): d is ToPlayer {
  return !!d && typeof d === 'object' && ['lobby', 'snap', 'result'].includes((d as { k?: string }).k ?? '');
}

/**
 * The answer used when a remote player can't answer (timed out, left, or sent nonsense):
 * never block, back out where that's allowed, otherwise the first choice.
 */
export function fallbackAnswer<D extends Decision>(d: D): Answer<D> {
  const a = (v: unknown) => v as Answer<D>;
  switch (d.kind) {
    case 'block': case 'paySavings': return a(false);
    case 'chooseSeat': case 'chooseWall': case 'chooseOption': return a(d.cancellable ? null : d.options[0] ?? null);
    case 'chooseHandCard': return a(d.optional ? null : d.options[0] ?? null);
    case 'pickCards': return a([]);
    case 'pickHandCards': return a(d.options.slice(0, d.min));
  }
}

/** Parse a remote answer, or the fallback if it doesn't fit the question. */
export function parseAnswer<D extends Decision>(d: D, text: string): Answer<D> {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return fallbackAnswer(d); }
  const ok = (() => {
    switch (d.kind) {
      case 'block': case 'paySavings': return typeof v === 'boolean';
      case 'chooseSeat': return v === null ? d.cancellable : d.options.includes(v as number);
      case 'chooseHandCard': return v === null ? d.optional : d.options.includes(v as number);
      case 'chooseOption': return v === null ? d.cancellable : d.options.includes(v as string);
      case 'chooseWall': return v === null ? d.cancellable
        : d.options.some(w => w.seat === (v as { seat?: number }).seat && w.kind === (v as { kind?: number }).kind);
      case 'pickCards': return Array.isArray(v) && v.length <= d.max && v.every(x => typeof x === 'number');
      case 'pickHandCards': return Array.isArray(v) && v.length >= d.min && v.length <= d.max
        && new Set(v).size === v.length && v.every(x => d.options.includes(x as number));
    }
  })();
  return ok ? v as Answer<D> : fallbackAnswer(d);
}
