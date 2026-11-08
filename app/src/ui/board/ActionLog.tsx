// "Game log", top left (the old "AI Log"): tap it to read the whole game back. The latest thing
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
        Game log
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
    <div class="board-modal" role="dialog" aria-label="Game log" onClick={onClose}>
      <div class="board-modal__box log" onClick={e => e.stopPropagation()}>
        <h2>Game log</h2>
        <ol class="log__list" ref={list}>
          {logLines(events).map((e, i) => (
            <li key={i} class={e.turn ? 'log__turn' : ''}>{e.text}</li>
          ))}
        </ol>
        <div class="board-modal__row"><Button onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}

/** A card play and its immediate draw are one action, not three noisy history entries. */
export function logLines(events: readonly GameEvent[]): { text: string; turn: boolean }[] {
  const out: { text: string; turn: boolean }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'deal' || e.type === 'turnEnd') continue;
    const next = events[i + 1];
    if (e.type === 'play' && next?.type === 'draw' && next.seat === e.seat) {
      // "Ann played Trump." + "Ann drew 3 cards." → "Ann played Trump and drew 3 cards."
      const drew = next.text.replace(/^.*? drew /, 'drew ').replace(/\.$/, '');
      out.push({ text: e.text.replace(/\.$/, '') + ' and ' + drew + '.', turn: false });
      i++;
    } else out.push({ text: e.text, turn: e.type === 'turnStart' });
  }
  return out;
}
