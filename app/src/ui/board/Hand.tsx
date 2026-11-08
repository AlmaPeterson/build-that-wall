// The viewer's hand, all of it in view: sorted by card colour, copies of a card stacked a little lower each
// (board/hand-layout.ts), smaller cards when the hand is big. While picking walls, only the cards that can be
// picked are clickable. A card pulled out of the hand follows the pointer, to drop it on the board.
import { cardById, type CardId } from '../../data/cards';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Seat } from '../../game';
import { displayOrder, handLayout } from './hand-layout';
import { cardImage } from '../assets';
import { showCard } from '../components/zoom';

export interface HandPicking {
  pickable: number[];   // slots that can be picked
  picked: number[];
}

interface Props {
  /** Whose hand it is. */
  seat: Seat;
  cards: readonly CardId[];
  onCard(slot: number): void;
  picking?: HandPicking | null;
  /**
   * A card pulled out of the hand follows the pointer around the board (to drop it on the discard pile or
   * your walls): called as it moves ('move'), when it's let go ('drop') and if the drag is cut off ('cancel').
   * x, y are viewport pixels. Without it, cards can only be tapped.
   */
  onLift?(slot: number, x: number, y: number, phase: 'move' | 'drop' | 'cancel'): void;
  /** Whose hand it says it is: "Your Hand" unless it's someone else's (a bots-only game). */
  title?: string;
  /** Double-click or right-click: see the card full size (default: just open it). */
  onZoom?(slot: number): void;
}

const DRAG_START_PX = 8;      // a press that moves further than this pulls the card out of the hand

const u = (n: number) => `calc(var(--u) * ${n.toFixed(2)})`;

export function Hand({ seat, cards, onCard, picking, onLift, title = 'Your Hand', onZoom }: Props) {
  const row = useRef<HTMLDivElement>(null);
  // When the hand changes, each card slides from where it was to its new place instead of jumping
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());
  const reflowAnimations = useRef(new Map<HTMLElement, Animation>());
  const known = useRef<{ seat: Seat; cards: readonly CardId[]; keys: string[] }>({ seat, cards: [], keys: [] });
  const nextKey = useRef(1);
  const press = useRef<{ x: number; y: number; slot: number; id: number; free: boolean } | null>(null);
  const [lifted, setLifted] = useState<number | null>(null);
  const swallowClick = useRef(false);
  const order = displayOrder(cards);
  const spots = handLayout(cards);
  // Each card keeps its key while it stays in the hand, even when an identical card leaves before it
  const identities = known.current.seat === seat && known.current.cards === cards ? known.current.keys
    : keepKeys(known.current.seat === seat ? known.current : { cards: [], keys: [] }, cards, () => 'card' + nextKey.current++);
  known.current = { seat, cards, keys: identities };

  const layoutKey = order.map(slot => identities[slot] + '@' + spots[slot]!.x.toFixed(1) + ',' + spots[slot]!.y.toFixed(1) + ',' + spots[slot]!.w.toFixed(1)).join(' ');
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const next = new Map<string, { x: number; y: number }>();
    for (const card of el.querySelectorAll<HTMLElement>('.hand__card[data-hand-key]')) {
      const key = card.dataset.handKey!;
      // Where it's laid out, not where it's drawn: a card halfway through a slide (or raised because it's
      // picked) isn't somewhere else
      const now = { x: card.offsetLeft, y: card.offsetTop };
      const before = previousPositions.current.get(key);
      next.set(key, now);
      if (!before || press.current?.free || !('animate' in card)) continue;
      let dx = before.x - now.x, dy = before.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Still sliding from the last change: carry on from where it is drawn now
      const running = reflowAnimations.current.get(card);
      if (running && running.playState === 'running') {
        const m = new DOMMatrixReadOnly(getComputedStyle(card).transform);
        dx += m.m41; dy += m.m42;
      }
      running?.cancel();
      const animation = card.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 240, easing: 'cubic-bezier(.2, .8, .25, 1)' });
      animation.finished.catch(() => {});
      reflowAnimations.current.set(card, animation);
    }
    previousPositions.current = next;
  }, [layoutKey]);
  useEffect(() => () => { for (const animation of reflowAnimations.current.values()) animation.cancel(); }, []);

  function down(e: PointerEvent, slot: number) {
    if (picking || !onLift || e.button > 0) return;
    press.current = { x: e.clientX, y: e.clientY, slot, id: e.pointerId, free: false };
  }

  function move(e: PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (!p.free) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return;
      p.free = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setLifted(p.slot);
    }
    onLift?.(p.slot, e.clientX, e.clientY, 'move');
  }

  function up(e: PointerEvent) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    press.current = null;
    if (!p.free) return;
    swallowClick.current = true;                         // the click that follows a drag isn't a tap
    setLifted(null);
    onLift?.(p.slot, e.clientX, e.clientY, e.type === 'pointercancel' ? 'cancel' : 'drop');
  }

  // Double-click / right-click (a long touch on phones): full size, unless a card is being dragged
  const zoom = (e: Event, slot: number, id: CardId) => {
    e.preventDefault();
    if (press.current?.free) return;
    if (onZoom) onZoom(slot); else showCard(id);
  };
  return (
    <>
      <div class="at hand__title">{title}</div>
      <div class="at hand" role="list" aria-label={title} ref={row}>
        {order.map(slot => {
          const id = cards[slot]!, at = spots[slot]!;
          const pickable = picking ? picking.pickable.includes(slot) : true;
          const picked = picking?.picked.includes(slot) ?? false;
          const cls = ['hand__card', picking && pickable && !picked ? 'hand__card--pickable' : '', picked ? 'hand__card--picked' : '',
            picking && !pickable ? 'hand__card--dim' : '', lifted === slot ? 'hand__card--lifted' : '', onLift ? 'hand__card--movable' : ''].join(' ');
          return (
            <button type="button" role="listitem" class={cls} key={identities[slot]} data-hand-key={identities[slot]} disabled={!pickable} data-slot={slot} data-card={id}
              style={{ left: u(at.x), top: u(at.y), width: u(at.w), height: u(at.h), zIndex: at.z }}
              aria-pressed={picking ? picked : undefined} title={cardById(id).name}
              onPointerDown={e => down(e, slot)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onClick={() => { if (swallowClick.current) { swallowClick.current = false; return; } onCard(slot); }}
              onDblClick={e => zoom(e, slot, id)} onContextMenu={e => zoom(e, slot, id)}>
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

/**
 * Keys for `cards` that keep each card's key from `before` while it stays in the hand. Matches the
 * longest run of cards left in the same order, so when one of two equal cards leaves, the one that
 * stayed keeps its own key (and doesn't seem to slide to the other one's place).
 */
export function keepKeys(before: { cards: readonly CardId[]; keys: readonly string[] }, cards: readonly CardId[], fresh: () => string): string[] {
  const a = before.cards, n = a.length, m = cards.length;
  // lcs[i][j]: how many cards of a[i..] and cards[j..] can be matched in order
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    lcs[i]![j] = a[i] === cards[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const keys = new Array<string>(m);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === cards[j] && lcs[i]![j] === lcs[i + 1]![j + 1]! + 1) { keys[j] = before.keys[i]!; i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
    else j++;
  }
  for (let k = 0; k < m; k++) keys[k] ??= fresh();
  return keys;
}
