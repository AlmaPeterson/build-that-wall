// "Game history", top left (the old "AI Log"): tap it to read the whole game back. The latest thing
// that happened is still read out to screen readers.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameEvent } from '../../game';
import { Button } from '../components/Button';

/** Not worth a line of their own at the top: they happen every turn. */
const ROUTINE: readonly string[] = ['deal', 'draw', 'turnStart', 'turnEnd', 'gameStart'];

export function ActionLog({ events }: { events: readonly GameEvent[] }) {
  const [open, setOpen] = useState(false);
  const last = [...events].reverse().find(e => !ROUTINE.includes(e.type));
  return (
    <>
      <button type="button" class="at board__log" title="Show everything that happened this game" onClick={() => setOpen(true)}>
        <svg class="board__log-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 4.2V8l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        Game history
      </button>
      <span class="visually-hidden" aria-live="polite">{last?.text ?? ''}</span>
      {open && <FullLog events={events} onClose={() => setOpen(false)} />}
    </>
  );
}

function FullLog({ events, onClose }: { events: readonly GameEvent[]; onClose(): void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: 'end' }); }, []);
  return (
    <div class="board-modal" role="dialog" aria-label="Game history" onClick={onClose}>
      <div class="board-modal__box log" onClick={e => e.stopPropagation()}>
        <h2>Game history</h2>
        <ol class="log__list" ref={list}>
          {events.filter(e => e.type !== 'deal' && e.type !== 'turnEnd').map((e, i) => (
            <li key={i} class={e.type === 'turnStart' ? 'log__turn' : ''}>{e.text}</li>
          ))}
        </ol>
        <div class="board-modal__row"><Button onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}
