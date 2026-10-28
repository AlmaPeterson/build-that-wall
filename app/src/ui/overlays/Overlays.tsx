// Everything drawn over the board: decision prompts, pass-the-device screen, turn recap, announcements,
// the final-round notice, the win screen and tutorial tips. The board renders <Overlays controller={c} />.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createBotMemory, think } from '../../game/bots';
import type { GameEvent } from '../../game';
import { controller as currentController, screen, settings, startLocalGame } from '../app-state';
import { playSfx } from '../audio';
import type { GameController } from '../controller';
import { animatorFor } from '../anim';
import { useStore } from '../store';
import { PromptView } from './Prompt';
import { BigNotice, PassScreen, Recap, TutorialTip, Toasts, WinScreen, type Toast } from './Screens';
import { bestMoveText, passWhy, recapFor, seatName, tipsFor, toastFor, type RecapLine } from './text';
import './overlays.css';

const TOAST_MS = 3200;
const tutorMemory = createBotMemory({ get: () => null, set: () => {} });   // tips don't learn

export function Overlays({ controller }: { controller: GameController }) {
  // What the board shows now: prompts and notices wait until the cards before them have moved
  const { snap } = useStore(animatorFor(controller).state);
  const { tutorial } = useStore(settings);
  const { view, viewer, events, prompt, passTo } = snap;

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notices, setNotices] = useState<GameEvent[]>([]);
  const [recap, setRecap] = useState<{ lines: RecapLine[]; myTurn: boolean } | null>(null);
  const [winClosed, setWinClosed] = useState(false);
  const [tipHidden, setTipHidden] = useState(false);
  const seen = useRef(0);
  const toastId = useRef(0);

  // React to new events: toasts, the final-round notice, and the recap when a human's turn starts
  useEffect(() => {
    if (events.length < seen.current) seen.current = 0;              // a new game
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    if (!fresh.length || !view) return;
    const newToasts: Toast[] = [];
    for (const e of fresh) {
      if (e.type === 'gameStart') { setWinClosed(false); setRecap(null); setNotices([]); }
      if (e.type === 'finalRound') { setNotices(n => [...n, e]); playSfx('alert'); continue; }
      if (e.type === 'gameOver') { playSfx('win'); continue; }
      if (e.type === 'turnStart' && e.seat !== undefined && !view.seats[e.seat]?.bot) {
        const lines = recapFor(events.slice(0, events.indexOf(e) + 1), e.seat, view);
        if (lines.length) setRecap({ lines, myTurn: true });
        continue;
      }
      // Play Immediately cards and blocks are already shown, with their caption, while the cards move
      if ((e.type === 'immediate' || e.type === 'blocked') && settings.get().animSpeed !== 'off') continue;
      const t = toastFor(e);
      if (t) newToasts.push({ id: ++toastId.current, ...t });
    }
    if (newToasts.length) {
      setToasts(ts => [...ts, ...newToasts].slice(-4));
      const ids = new Set(newToasts.map(t => t.id));
      setTimeout(() => setToasts(ts => ts.filter(t => !ids.has(t.id))), TOAST_MS);
    }
  }, [events, view]);

  // A sound when a question comes up
  useEffect(() => { if (prompt) playSfx('prompt'); }, [prompt]);

  const tip = useMemo(() => {
    const api = controller.api, state = controller.state;
    if (!tutorial || tipHidden || !api || !state || state.over || prompt || passTo !== null) return null;
    if (state.turn !== viewer || state.seats[viewer]?.bot) return null;
    try {
      return { best: bestMoveText(think(api, viewer, tutorMemory, 'hard'), state, viewer), tips: tipsFor(state, viewer, state.actionsLeft) };
    } catch {
      return null;                                                    // the board is mid-update; try again next render
    }
  }, [tutorial, tipHidden, events.length, prompt, passTo, viewer, controller]);

  if (!view) return null;

  const playAgain = () => { const s = controller.state?.settings; if (s) startLocalGame(s); };
  const toMenu = () => { currentController.set(null); screen.set('menu'); };

  let modal = null;
  if (passTo !== null) {
    modal = <PassScreen name={seatName(view, passTo)} why={passWhy(events, passTo, view)} onReady={() => controller.ready()} />;
  } else if (prompt) {
    modal = <PromptView prompt={prompt} view={view} />;
  } else if (view.over && !winClosed) {
    modal = <WinScreen result={view.over} view={view} onAgain={playAgain} onMenu={() => { setWinClosed(true); toMenu(); }} />;
  } else if (notices.length) {
    const n = notices[0]!;
    modal = <BigNotice head="FINAL ROUND" title={n.text.startsWith('The last card') ? 'LAST CARD!' : 'FINAL ROUND!'} sub={n.text}
      onClose={() => setNotices(ns => ns.slice(1))} />;
  } else if (recap) {
    modal = <Recap lines={recap.lines} myTurn={recap.myTurn} onClose={() => setRecap(null)} />;
  }

  return (
    <div class="btw-overlays">
      {modal}
      <Toasts toasts={toasts} />
      {tip && !modal && <TutorialTip best={tip.best} tips={tip.tips} onHide={() => setTipHidden(true)} />}
    </div>
  );
}
