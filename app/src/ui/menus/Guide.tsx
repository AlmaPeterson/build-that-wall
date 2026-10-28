// "How to play & use the site": topics on the left, one page at a time, Back / Next.
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { GUIDE_PAGES } from './guide-pages';
import './menus.css';

interface Props {
  /** 1-based page to open on, like the old guide block's PAGE argument. */
  page?: number;
  onClose: () => void;
  /** Shown on the last page, e.g. "Start a tutorial game". */
  finishLabel?: string;
  onFinish?: () => void;
}

export function Guide({ page = 1, onClose, finishLabel, onFinish }: Props) {
  const [i, setI] = useState(Math.max(0, Math.min(GUIDE_PAGES.length - 1, page - 1)));
  const p = GUIDE_PAGES[i]!;
  const last = i === GUIDE_PAGES.length - 1;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && !last) setI(i + 1);
      if (e.key === 'ArrowLeft' && i) setI(i - 1);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [i, last, onClose]);
  return (
    <div class="guide" role="dialog" aria-modal="true" aria-label="How to play and use the site">
      <div class="guide__box">
        <header class="guide__head">
          <b>HOW TO PLAY &amp; USE THE SITE</b>
          <button type="button" class="guide__x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div class="guide__body">
          <nav class="guide__nav">
            {GUIDE_PAGES.map((g, k) => (
              <button type="button" key={g.t} class={k === i ? 'is-current' : ''} onClick={() => setI(k)}>{k + 1}. {g.t}</button>
            ))}
          </nav>
          <section class="guide__page">
            <h2>{p.t}</h2>
            {/* Fixed SVG strings from guide-pages.ts, never player text */}
            <div dangerouslySetInnerHTML={{ __html: p.art }} />
            <ul>{p.s.map(s => <li key={s}>{s}</li>)}</ul>
          </section>
        </div>
        <footer class="guide__foot">
          <Button color="plain" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => setI(i - 1)}>◀ Back</Button>
          <span>Page {i + 1} of {GUIDE_PAGES.length}</span>
          {last && onFinish
            ? <Button onClick={onFinish}>{finishLabel ?? 'Done ✓'}</Button>
            : <Button onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Done ✓' : 'Next ▶'}</Button>}
        </footer>
      </div>
    </div>
  );
}
