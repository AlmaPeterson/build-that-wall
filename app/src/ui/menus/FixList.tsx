// The owner's To-fix list (opened from the home page's footer, only on the owner's account; no link of its own).
// Tick the box when a fix is done; the trash means "won't do". Both can be undone further down.
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { fixes, fixKey, loadFixes, setFix, sortFixes, type Fix } from '../fixes';
import { useStore } from '../store';
import './fixes.css';

const TYPES: Record<string, string> = { bug: 'Bug', feature: 'New idea', change: 'Change', balance: 'Balance', exploit: 'Cheat or exploit', strategy: 'Strategy tip', other: 'Other' };
const day = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Row({ f }: { f: Fix }) {
  const [more, setMore] = useState(false);
  const done = f.status === 'done', skipped = f.status === 'skip';
  const id = 'fix-' + fixKey(f).replace(':', '-');
  return (
    <li class={'fix' + (done ? ' fix--done' : '') + (skipped ? ' fix--skip' : '')}>
      {!skipped && (
        <input type="checkbox" class="fix__check" id={id} checked={done} aria-label={(done ? 'Not done: ' : 'Done: ') + f.text}
          onChange={() => void setFix(f, done ? '' : 'done')} />
      )}
      <div class="fix__body">
        <label for={skipped ? undefined : id} class="fix__text">{f.text}</label>
        <div class="fix__meta">
          <span class={'fix__tag fix__tag--' + f.type}>{TYPES[f.type] ?? f.type}</span>
          {f.list === 'private' && <span class="fix__tag fix__tag--private">Private</span>}
          <span>{f.asked === 1 ? 'Asked once' : 'Asked ' + f.asked + ' times'}</span>
          <span>{day(f.last)}</span>
          {f.device && <button type="button" class="fix__link" onClick={() => setMore(!more)}>{more ? 'Hide device' : 'Device'}</button>}
        </div>
        {more && f.device && <pre class="fix__device">{f.device}</pre>}
      </div>
      {skipped
        ? <button type="button" class="fix__link fix__back" onClick={() => void setFix(f, '')}>Put back</button>
        : !done && (
          <button type="button" class="fix__trash" aria-label={"Won't do: " + f.text} title="Won't do" onClick={() => void setFix(f, 'skip')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z" /></svg>
          </button>
        )}
    </li>
  );
}

export function FixList({ onClose }: { onClose: () => void }) {
  const { items, loading, error } = useStore(fixes);
  useEffect(() => { void loadFixes(); }, []);
  const all = sortFixes(items);
  const todo = all.filter(f => !f.status), done = all.filter(f => f.status === 'done'), skipped = all.filter(f => f.status === 'skip');
  return (
    <Modal title="To-fix list" onClose={onClose}>
      <div class="fixes">
        <p class="btw-muted">Everything players asked for, most asked first. Tick the box when it's done; press the trash if you won't do it. Only you can see this list.</p>
        {error && <p class="fixes__error" role="alert">{error}</p>}
        {loading && !items.length && <p>Loading…</p>}
        {!loading && !error && !items.length && <p>No feedback yet.</p>}
        {items.length > 0 && (
          <>
            <h3 class="fixes__head">To do ({todo.length})</h3>
            {todo.length ? <ul class="fixes__list">{todo.map(f => <Row key={fixKey(f)} f={f} />)}</ul> : <p class="btw-muted">Nothing left to do.</p>}
            {done.length > 0 && (
              <details class="fixes__more"><summary>Done ({done.length})</summary><ul class="fixes__list">{done.map(f => <Row key={fixKey(f)} f={f} />)}</ul></details>
            )}
            {skipped.length > 0 && (
              <details class="fixes__more"><summary>Won't do ({skipped.length})</summary><ul class="fixes__list">{skipped.map(f => <Row key={fixKey(f)} f={f} />)}</ul></details>
            )}
          </>
        )}
        <div class="play__buttons">
          <Button color="plain" onClick={() => void loadFixes()} disabled={loading}>Refresh</Button>
          <Button color="plain" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
