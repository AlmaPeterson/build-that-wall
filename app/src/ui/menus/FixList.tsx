// The To-fix list, in Account & Store > Feedback. Everyone can read it; only the owner gets the checkbox
// (done) and the trash (won't do), and both can be undone further down. The server checks every change.
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { fixes, fixKey, fixPrompt, loadFixes, setFix, sortFixes, type Fix } from '../fixes';
import { useStore } from '../store';
import './fixes.css';

const TYPES: Record<string, string> = { bug: 'Bug', feature: 'New idea', change: 'Change', balance: 'Balance', exploit: 'Cheat or exploit', strategy: 'Strategy tip', other: 'Other' };
const day = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Row({ f, owner }: { f: Fix; owner: boolean }) {
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(fixPrompt(f)); setCopied('Copied!'); }
    catch { setCopied("Couldn't copy"); }
    setTimeout(() => setCopied(''), 2000);
  };
  const done = f.status === 'done', skipped = f.status === 'skip';
  const id = 'fix-' + fixKey(f).replace(':', '-');
  return (
    <li class={'fix' + (done ? ' fix--done' : '') + (skipped ? ' fix--skip' : '')}>
      {!owner && <span class={'fix__mark' + (done ? ' fix__mark--done' : '')} aria-hidden="true">{done ? '✓' : '•'}</span>}
      {owner && !skipped && (
        <input type="checkbox" class="fix__check" id={id} checked={done} aria-label={(done ? 'Not done: ' : 'Done: ') + f.text}
          onChange={() => void setFix(f, done ? '' : 'done')} />
      )}
      <div class="fix__body">
        {owner ? <label for={skipped ? undefined : id} class="fix__text">{f.text}</label>
          : <span class="fix__text">{f.text}{done && <span class="sr-only"> (done)</span>}</span>}
        <div class="fix__meta">
          <span class={'fix__tag fix__tag--' + f.type}>{TYPES[f.type] ?? f.type}</span>
          {f.list === 'private' && <span class="fix__tag fix__tag--private">Private</span>}
          <span>{f.asked === 1 ? 'Asked once' : 'Asked ' + f.asked + ' times'}</span>
          <span>{day(f.last)}</span>
          {owner && !skipped && <button type="button" class="fix__link" title="Copy a request for Claude Code to make this fix" onClick={() => void copy()}>{copied || 'Copy prompt'}</button>}
          {owner && f.device && <button type="button" class="fix__link" onClick={() => setMore(!more)}>{more ? 'Hide device' : 'Device'}</button>}
        </div>
        {more && f.device && <pre class="fix__device">{f.device}</pre>}
      </div>
      {!owner ? null : skipped
        ? <button type="button" class="fix__link fix__back" onClick={() => void setFix(f, '')}>Put back</button>
        : !done && (
          <button type="button" class="fix__trash" aria-label={"Won't do: " + f.text} title="Won't do" onClick={() => void setFix(f, 'skip')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z" /></svg>
          </button>
        )}
    </li>
  );
}

export function FixList() {
  const { items, loading, error, owner } = useStore(fixes);
  useEffect(() => { void loadFixes(); }, []);
  const all = sortFixes(items);
  const todo = all.filter(f => !f.status), done = all.filter(f => f.status === 'done'), skipped = all.filter(f => f.status === 'skip');
  const rows = (l: Fix[]) => <ul class="fixes__list">{l.map(f => <Row key={fixKey(f)} f={f} owner={owner} />)}</ul>;
  return (
    <div class="fixes">
      <h3 class="fixes__title">To-fix list</h3>
      <p class="btw-muted">
        {owner
          ? "You're the owner: tick the box when a fix is done, or press the trash if you won't do it. Everyone else can only read this list."
          : 'What players have asked for, most asked first. A ✓ means it has been done.'}
      </p>
      {error && <p class="fixes__error" role="alert">{error}</p>}
      {loading && !items.length && <p>Loading…</p>}
      {!loading && !error && !items.length && <p>Nothing on the list yet.</p>}
      {items.length > 0 && (
        <>
          <h4 class="fixes__head">To do ({todo.length})</h4>
          {todo.length ? rows(todo) : <p class="btw-muted">Nothing left to do.</p>}
          {done.length > 0 && <details class="fixes__more"><summary>Done ({done.length})</summary>{rows(done)}</details>}
          {owner && skipped.length > 0 && <details class="fixes__more"><summary>Won't do ({skipped.length})</summary>{rows(skipped)}</details>}
        </>
      )}
      <div class="btw-row"><Button color="plain" onClick={() => void loadFixes()} disabled={loading}>Refresh list</Button></div>
    </div>
  );
}
