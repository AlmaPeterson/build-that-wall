// "How to play & use the site": topics on the left, one page at a time, Back / Next.
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button';
import { GUIDE_PAGES, type GuidePage } from './guide-pages';
import { INSTRUCTION_PAGES } from './instructions';
import './menus.css';

interface Props {
  /** 1-based page to open on, like the old guide block's PAGE argument. */
  page?: number;
  onClose: () => void;
  /** Shown on the last page, e.g. "Start a tutorial game". */
  finishLabel?: string;
  onFinish?: () => void;
}

/** Welcome, then the four rules pages (what Instructions shows), then the illustrated pages. */
export const TUTORIAL_PAGES: GuidePage[] = [
  GUIDE_PAGES[0]!,
  ...INSTRUCTION_PAGES.map(p => ({ t: 'Rules: ' + p.title, art: '', s: p.points, numbered: p.numbered })),
  ...GUIDE_PAGES.slice(1),
];

export function Guide({ page = 1, onClose, finishLabel, onFinish }: Props) {
  const [i, setI] = useState(Math.max(0, Math.min(TUTORIAL_PAGES.length - 1, page - 1)));
  const p = TUTORIAL_PAGES[i]!;
  const last = i === TUTORIAL_PAGES.length - 1;
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
            {TUTORIAL_PAGES.map((g, k) => (
              <button type="button" key={g.t} class={k === i ? 'is-current' : ''} onClick={() => setI(k)}>{k + 1}. {g.t}</button>
            ))}
            <a class="guide__full" href="./guide.html" target="_blank" rel="noopener">Full guide ↗</a>
          </nav>
          <section class="guide__page">
            <h2>{p.t}</h2>
            {/* Fixed SVG strings from guide-pages.ts, never player text */}
            <div dangerouslySetInnerHTML={{ __html: p.art }} />
            {p.numbered
              ? <ol>{p.s.map(s => <li key={s}>{s}</li>)}</ol>
              : <ul>{p.s.map(s => <li key={s}>{s}</li>)}</ul>}
          </section>
        </div>
        <footer class="guide__foot">
          <Button color="plain" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => setI(i - 1)}>◀ Back</Button>
          <span>Page {i + 1} of {TUTORIAL_PAGES.length}</span>
          {last && onFinish
            ? <Button onClick={onFinish}>{finishLabel ?? 'Done ✓'}</Button>
            : <Button onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Done ✓' : 'Next ▶'}</Button>}
        </footer>
      </div>
    </div>
  );
}
