// A question for a human player: one view per Decision kind (src/game/types.ts), answered through prompt.answer().
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CardId, Decision, GameState, Seat, WallRef } from '../../game';
import { CardImage } from '../components/CardImage';
import { RESIZE_TITLE, useDraggable } from '../components/drag';
import { showCard } from '../components/zoom';
import type { Prompt } from '../controller';
import { cardName, optionLabel, promptTitle, seatName } from './text';

/** Seconds to pick cards from a pile before the picks so far are taken (section 9, `pool pick`). */
export const PICK_SECONDS = 30;

interface Props {
  prompt: Prompt;
  view: GameState;
}

export function PromptView({ prompt, view }: Props) {
  const d = prompt.decision;
  // Each Decision kind's answer type is checked where it's built below
  const answer = prompt.answer as (v: unknown) => void;
  switch (d.kind) {
    case 'block':
      return (
        <Shell d={d} view={view} title={promptTitle(d.kind, d.card)}
          sub={seatName(view, d.attacker) + ' played ' + cardName(d.card) + ' on you.'}>
          <Choices>
            <Choice onClick={() => answer(true)}>Block it</Choice>
            <Choice plain onClick={() => answer(false)}>Don't block</Choice>
          </Choices>
        </Shell>
      );
    case 'paySavings':
      return (
        <Shell d={d} view={view} card={d.wall ?? 7} title={promptTitle(d.kind, 7)}
          sub={seatName(view, d.attacker) + ' played Debt to take ' + (d.wall !== undefined ? 'your ' + cardName(d.wall) : 'one of your walls') + '. Pay with Savings to keep it.'}>
          <Choices>
            <Choice onClick={() => answer(true)}>Pay with Savings</Choice>
            <Choice plain onClick={() => answer(false)}>Let them take it</Choice>
          </Choices>
        </Shell>
      );
    case 'chooseSeat':
      return (
        <Shell d={d} view={view} title={promptTitle(d.kind, d.card)} onCancel={d.cancellable ? () => answer(null) : undefined}>
          <Choices>
            {d.options.map(seat => (
              <Choice key={seat} onClick={() => answer(seat)}>
                {seatName(view, seat)} <small>({view.seats[seat]?.hand.length ?? 0} cards)</small>
              </Choice>
            ))}
          </Choices>
        </Shell>
      );
    case 'chooseWall':
      return (
        <Shell d={d} view={view} title={promptTitle(d.kind, d.card)} onCancel={d.cancellable ? () => answer(null) : undefined}>
          <Walls options={d.options} view={view} onPick={w => answer(w)} />
        </Shell>
      );
    case 'chooseHandCard': {
      const hand = view.seats[d.seat]?.hand ?? [];
      const sub = d.purpose === 'give' && d.to !== undefined
        ? (d.to === d.seat ? 'This one stays with you.' : 'It goes to ' + seatName(view, d.to) + '.')
        : undefined;
      return (
        <Shell d={d} view={view} title={promptTitle(d.kind, d.card, d.purpose)} sub={sub}
          onCancel={d.optional ? () => answer(null) : undefined} cancelText={d.purpose === 'build' ? 'Stop building' : 'Skip'}>
          <div class="btw-ov-cards">
            {d.options.map(slot => hand[slot] === undefined ? null : (
              <CardButton key={slot} id={hand[slot]!} onClick={() => answer(slot)} />
            ))}
          </div>
        </Shell>
      );
    }
    case 'pickCards':
      return <PickCards d={d} view={view} onDone={ids => answer(ids)} />;
    case 'pickHandCards':
      return <PickHandCards d={d} view={view} onDone={slots => answer(slots)} />;
    case 'chooseOption':
      return (
        <Shell d={d} view={view} title={cardName(d.card)} onCancel={d.cancellable ? () => answer(null) : undefined}>
          <Choices>
            {d.options.map(o => <Choice key={o} onClick={() => answer(o)}>{optionLabel(o)}</Choice>)}
          </Choices>
        </Shell>
      );
  }
}

// ---- pieces

function Shell(props: {
  d: Decision; view: GameState; title: string; sub?: string; card?: CardId;
  onCancel?: () => void; cancelText?: string; children: ComponentChildren;
}) {
  const { d, view, title, sub, onCancel, cancelText = 'Cancel', children } = props;
  const card = props.card ?? ('card' in d ? d.card : undefined);
  const drag = useDraggable('prompt'), box = drag.ref;
  useEffect(() => { box.current?.querySelector<HTMLElement>('button')?.focus(); }, [d]);
  useEffect(() => {
    if (!onCancel) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onCancel]);
  return (
    <div class={'btw-ov-backdrop' + (drag.moved ? ' btw-ov-backdrop--moved' : '')}>
      <div class="btw-ov-box drag-box" role="dialog" aria-modal="true" aria-label={title} ref={box} style={drag.style}>
        <div class="btw-ov-head">{seatName(view, d.seat)}</div>
        <div class="btw-ov-body">
          {card !== undefined && <CardImage id={card} size="thumb" class="btw-ov-cause" zoomable />}
          <div class="btw-ov-main">
            <h2 class="btw-ov-title">{title}</h2>
            {sub && <p class="btw-ov-sub">{sub}</p>}
            {children}
            {onCancel && <button type="button" class="btw-ov-btn btw-ov-btn--plain" onClick={onCancel}>{cancelText}</button>}
          </div>
        </div>
        <div class="btw-ov-foot" />
        <span class="drag-grip" title={RESIZE_TITLE} aria-hidden="true" />
      </div>
    </div>
  );
}

const Choices = ({ children }: { children: ComponentChildren }) => <div class="btw-ov-choices">{children}</div>;

function Choice({ plain, onClick, children }: { plain?: boolean; onClick: () => void; children: ComponentChildren }) {
  return <button type="button" class={'btw-ov-btn' + (plain ? ' btw-ov-btn--plain' : '')} onClick={onClick}>{children}</button>;
}

function CardButton({ id, onClick, badge, picked }: { id: CardId; onClick: () => void; badge?: string; picked?: boolean }) {
  return (
    <span class="btw-ov-cardwrap">
      <button type="button" class={'btw-ov-card' + (picked ? ' btw-ov-card--picked' : '')} onClick={onClick}
        aria-label={cardName(id) + (badge ? ', ' + badge : '')} aria-pressed={picked === undefined ? undefined : picked}>
        <CardImage id={id} size="thumb" aria-hidden="true" />
        {badge && <span class="btw-ov-badge">{badge}</span>}
      </button>
      {/* Tapping the card picks it; the magnifier shows it full size */}
      <button type="button" class="btw-ov-zoom" aria-label={'See ' + cardName(id) + ' full size'} onClick={() => showCard(id)}>⌕</button>
    </span>
  );
}

function Walls({ options, view, onPick }: { options: WallRef[]; view: GameState; onPick: (w: WallRef) => void }) {
  const bySeat = new Map<Seat, WallRef[]>();
  for (const w of options) bySeat.set(w.seat, [...(bySeat.get(w.seat) ?? []), w]);
  return (
    <div class="btw-ov-walls">
      {[...bySeat].map(([seat, walls]) => (
        <div key={seat} class="btw-ov-wallrow">
          <div class="btw-ov-wallseat">{seatName(view, seat)}</div>
          <div class="btw-ov-cards">
            {walls.map(w => {
              const n = view.seats[w.seat]?.walls.filter(k => k === w.kind).length ?? 0;
              return <CardButton key={w.seat + ':' + w.kind} id={w.kind} badge={'×' + n} onClick={() => onPick(w)} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tick between `min` and `max` cards of your hand (e.g. the walls to build for free), then confirm once. */
function PickHandCards({ d, view, onDone }: { d: Extract<Decision, { kind: 'pickHandCards' }>; view: GameState; onDone: (slots: number[]) => void }) {
  const [picks, setPicks] = useState<number[]>([]);
  const toggle = (slot: number) => setPicks(p => (p.includes(slot) ? p.filter(s => s !== slot)
    : p.length < d.max ? [...p, slot] : d.max === 1 ? [slot] : p));
  const sets = d.card === 23;
  const what = (n: number) => n + (sets ? (n === 1 ? ' set' : ' sets') : (n === 1 ? ' wall' : ' walls'));
  const sub = (d.min === d.max ? 'Pick ' + what(d.max) : 'Pick up to ' + what(d.max)) + ', then build them all at once.'
    + (sets && d.max > 1 ? ' Each set after the first costs 1 action.' : '');
  return (
    <Shell d={d} view={view} title={promptTitle(d.kind, d.card, d.purpose)} sub={sub}>
      <div class="btw-ov-cards">
        {d.options.map((slot, i) => (
          <CardButton key={slot} id={d.cards[i]!} picked={picks.includes(slot)} badge={picks.includes(slot) ? '✓ ' + (picks.indexOf(slot) + 1) : undefined}
            onClick={() => toggle(slot)} />
        ))}
      </div>
      <Choices>
        <Choice onClick={() => { if (picks.length >= d.min) onDone(picks); }}>
          {picks.length >= d.min ? 'Build ' + what(picks.length) : 'Pick ' + (d.min - picks.length) + ' more'}
        </Choice>
      </Choices>
    </Shell>
  );
}

/** Pick up to `max` cards from a pool shown grouped by kind with counts, before the timer runs out. */
function PickCards({ d, view, onDone }: { d: Extract<Decision, { kind: 'pickCards' }>; view: GameState; onDone: (ids: CardId[]) => void }) {
  const [picks, setPicks] = useState<CardId[]>([]);
  const [left, setLeft] = useState(PICK_SECONDS);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const finished = useRef(false);
  const finish = (ids: CardId[]) => { if (finished.current) return; finished.current = true; onDone(ids); };

  useEffect(() => {
    const t = setInterval(() => setLeft(s => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left <= 0) finish(picksRef.current); }, [left]);

  const groups = useMemo(() => {
    const counts = new Map<CardId, number>();
    for (const id of d.pool) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0] - b[0]);
  }, [d.pool]);
  const remaining = (id: CardId) => (groups.find(g => g[0] === id)?.[1] ?? 0) - picks.filter(p => p === id).length;
  const add = (id: CardId) => {
    if (picks.length >= d.max || remaining(id) <= 0) return;
    const next = [...picks, id];
    setPicks(next);
    if (next.length >= d.max) finish(next);
  };

  return (
    <Shell d={d} view={view} title={promptTitle(d.kind, d.card)}
      sub={'Pick up to ' + d.max + (d.max === 1 ? ' card' : ' cards') + '. ' + Math.max(0, left) + ' seconds left.'}>
      <div class="btw-ov-cards btw-ov-cards--pool">
        {groups.map(([id]) => {
          const n = remaining(id);
          return n > 0 ? <CardButton key={id} id={id} badge={'×' + n} onClick={() => add(id)} /> : null;
        })}
      </div>
      {picks.length > 0 && (
        <div class="btw-ov-picked">
          <span>Your picks:</span>
          {picks.map((id, i) => (
            <button type="button" key={i} class="btw-ov-card btw-ov-card--small" aria-label={'Put back ' + cardName(id)}
              onClick={() => setPicks(picks.filter((_, j) => j !== i))}>
              <CardImage id={id} size="mini" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <Choices><Choice onClick={() => finish(picks)}>Done</Choice></Choices>
    </Shell>
  );
}
