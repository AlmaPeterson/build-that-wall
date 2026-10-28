// The last thing that happened, top left (the old "AI Log"). Tap it to read the whole game back.
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
      <button type="button" class="at board__log" aria-live="polite" title="Show everything that happened this game"
        onClick={() => setOpen(true)}>
        {last?.text ?? 'Tap here to see what happened'}
      </button>
      {open && <FullLog events={events} onClose={() => setOpen(false)} />}
    </>
  );
}

function FullLog({ events, onClose }: { events: readonly GameEvent[]; onClose(): void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: 'end' }); }, []);
  return (
    <div class="board-modal" role="dialog" aria-label="What happened this game" onClick={onClose}>
      <div class="board-modal__box log" onClick={e => e.stopPropagation()}>
        <h2>What happened</h2>
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
