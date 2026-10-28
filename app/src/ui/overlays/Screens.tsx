// Full-screen overlays: pass the device, while you were away, the big notice, the win screen,
// toasts and the tutorial tip. Ported from the old game's BTW Links screens.
import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { GameResult, GameState } from '../../game';
import { CardImage } from '../components/CardImage';
import { seatName, type RecapLine } from './text';

/** Focus the first button when shown; Enter (and Escape where allowed) presses it. */
function useKeys(onOk: () => void, escape: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) onOk();
      if (e.key === 'Escape' && escape) onOk();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onOk, escape]);
  return ref;
}

/** Ignore taps in the first moment, so a tap meant for the last screen can't skip this one. */
export const PASS_GUARD_MS = 700;

export function PassScreen({ name, why, onReady }: { name: string; why: string; onReady: () => void }) {
  const shown = useRef(Date.now());
  const ready = () => { if (Date.now() - shown.current >= PASS_GUARD_MS) onReady(); };
  const ref = useKeys(ready, false);
  useEffect(() => { try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ } }, []);
  return (
    <div class="btw-ov-full btw-pass" ref={ref} role="dialog" aria-modal="true" aria-label={'Pass the device to ' + name}>
      <div class="btw-pass-card">
        <div class="btw-pass-kick">Pass the device</div>
        <svg class="btw-pass-hand" viewBox="0 0 160 90" aria-hidden="true">
          <path d="M20 70h120" stroke="#ffd84d" stroke-width="4" stroke-dasharray="8 8" stroke-linecap="round" />
          <g class="dev"><rect x="58" y="6" width="44" height="72" rx="8" fill="#fff" /><rect x="63" y="14" width="34" height="52" rx="3" fill="#1f22f5" />
            <path d="M72 40h16m-6-7 7 7-7 7" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" /><circle cx="80" cy="72" r="3" fill="#1f22f5" /></g>
        </svg>
        <div class="btw-pass-to">Pass the device to</div>
        <div class="btw-pass-name">{name}</div>
        {why && <div class="btw-pass-why">{why}</div>}
        <div class="btw-pass-peek">EVERYONE ELSE: NO PEEKING!</div>
        <button type="button" class="btw-pass-go" onClick={ready}>I'm {name} - show me</button>
      </div>
    </div>
  );
}

function Framed({ head, children, label }: { head: string; label: string; children: ComponentChildren }) {
  return (
    <div class="btw-ov-backdrop">
      <div class="btw-ov-frame" role="dialog" aria-modal="true" aria-label={label}>
        <div class="btw-ov-framehead">{head}</div>
        {children}
        <div class="btw-ov-foot" />
      </div>
    </div>
  );
}

/** "While you were away": what happened to this player since their last turn (`turnRecap`). */
export function Recap({ lines, myTurn, onClose }: { lines: RecapLine[]; myTurn: boolean; onClose: () => void }) {
  const ref = useKeys(onClose, true);
  return (
    <div ref={ref}>
      <Framed head="WHILE YOU WERE AWAY" label="While you were away">
        <div class="btw-recap-list">
          {lines.map((l, i) => (
            <div key={i} class="btw-recap-row">
              {l.card !== undefined && <CardImage id={l.card} size="thumb" class="btw-recap-cause" zoomable />}
              <div class="btw-recap-body">
                <div class="btw-recap-text">{l.text}</div>
                {(l.lost?.length || l.got?.length) ? (
                  <div class="btw-recap-walls">
                    {l.lost?.map((c, j) => <Fig key={'l' + j} id={c} label="Lost" tone="lost" />)}
                    {l.got?.map((c, j) => <Fig key={'g' + j} id={c} label="Got" tone="got" />)}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div class="btw-ov-center"><button type="button" class="btw-ov-btn" onClick={onClose}>{myTurn ? "OK, it's my turn" : 'OK'}</button></div>
      </Framed>
    </div>
  );
}

function Fig({ id, label, tone }: { id: number; label: string; tone: 'lost' | 'got' }) {
  return (
    <figure class={'btw-recap-fig btw-recap-fig--' + tone}>
      <CardImage id={id} size="mini" zoomable />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** A big tilted headline, e.g. FINAL ROUND (`bigNotice`). */
/** "Player 1's turn", sliding across for a moment before a turn starts (one person playing: no pass screen). */
export function TurnBanner({ name }: { name: string }) {
  return (
    <div class="btw-turn" role="status" aria-live="assertive">
      <div class="btw-turn-band"><span class="btw-turn-name">{name}</span>'s turn</div>
    </div>
  );
}

export function BigNotice({ head, title, sub, onClose }: { head: string; title: string; sub: string; onClose: () => void }) {
  const ref = useKeys(onClose, true);
  return (
    <div ref={ref}>
      <Framed head={head} label={title}>
        <div class="btw-big-title">{title}</div>
        <div class="btw-big-sub">{sub}</div>
        <div class="btw-ov-center"><button type="button" class="btw-ov-btn" onClick={onClose}>OK</button></div>
      </Framed>
    </div>
  );
}

/** Game over: winners, miles per seat, play again or back to the menu (`winScreen`). */
export function WinScreen({ result, view, onAgain, onMenu }: { result: GameResult; view: Pick<GameState, 'seats'>; onAgain: () => void; onMenu: () => void }) {
  const ref = useKeys(onMenu, false);
  const names = result.winners.map(s => seatName(view, s));
  const title = names.length > 1 ? "It's a tie: " + names.join(' & ') : names[0] + ' wins!';
  const rows = result.miles.map((miles, seat) => ({ seat, miles })).sort((a, b) => b.miles - a.miles);
  const best = Math.max(1, ...rows.map(r => r.miles));
  return (
    <div class="btw-ov-full btw-win" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
      <div class="btw-win-body">
        <div><span class="btw-win-ribbon">WALL COMPLETE</span></div>
        <div class="btw-win-title">{title}</div>
        <div class="btw-win-reason">{result.reason}</div>
        <div class="btw-win-board">
          {rows.map((r, i) => (
            <div key={r.seat} class={'btw-win-score' + (result.winners.includes(r.seat) ? ' top' : '')}>
              <span class="btw-win-rank">{i + 1}</span>
              <span class="btw-win-who">{seatName(view, r.seat)}</span>
              <span class="btw-win-bar"><i style={{ width: (100 * r.miles / best) + '%' }} /></span>
              <span class="btw-win-miles">{r.miles}{r.miles === 1 ? ' mile' : ' miles'}</span>
            </div>
          ))}
        </div>
        <div class="btw-ov-choices">
          <button type="button" class="btw-ov-btn btw-ov-btn--gold" onClick={onAgain}>Play again</button>
          <button type="button" class="btw-ov-btn" onClick={onMenu}>Back to menu</button>
        </div>
      </div>
      <div class="btw-win-wall" aria-hidden="true">
        {[0, 1, 2].map(r => <div key={r} class={'btw-win-row' + (r % 2 ? ' off' : '')}>{Array.from({ length: 26 }, (_, c) => <div key={c} class="btw-win-brick" style={{ animationDelay: (r * 0.25 + ((c * 7) % 10) * 0.03) + 's' }} />)}</div>)}
      </div>
    </div>
  );
}

export interface Toast { id: number; text: string; tone: 'info' | 'alert' | 'good' }

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div class="btw-toasts" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} class={'btw-toast btw-toast--' + t.tone}>{t.text}</div>)}
    </div>
  );
}

/** The TUTORIAL TIP box: the best move and a few tips for the player whose turn it is (section 12). */
export function TutorialTip({ best, tips, onHide }: { best: string; tips: string[]; onHide: () => void }) {
  return (
    <aside class="btw-tip" aria-label="Tutorial tip">
      <div class="btw-tip-head">TUTORIAL TIP <button type="button" class="btw-tip-x" aria-label="Hide tip" onClick={onHide}>×</button></div>
      <div class="btw-tip-best"><b>BEST MOVE:</b> {best}</div>
      <ul>{tips.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}</ul>
    </aside>
  );
}

