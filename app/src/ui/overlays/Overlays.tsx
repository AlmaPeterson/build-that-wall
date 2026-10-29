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
import { BigNotice, PassScreen, Recap, TurnBanner, TutorialTip, Toasts, WinScreen, type Toast } from './Screens';
import { bestMoveText, passWhy, recapFor, seatName, tipsFor, toastFor, waitingText, wallToastFor, type RecapLine } from './text';
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
    const wallsToasted = new Set<number>();
    for (const e of fresh) {
      if (e.type === 'gameStart') { setWinClosed(false); setRecap(null); setNotices([]); }
      if (e.type === 'finalRound') { setNotices(n => [...n, e]); playSfx('alert'); continue; }
      if (e.type === 'gameOver') { playSfx('win'); continue; }
      // Only the player whose turn it is, on their own screen (not another player's, online or in Pass'n'Play)
      if (e.type === 'turnStart' && e.seat !== undefined && !view.seats[e.seat]?.bot && e.seat === viewer) {
        const lines = recapFor(events.slice(0, events.indexOf(e) + 1), e.seat, view);
        if (lines.length) setRecap({ lines, myTurn: true });
        continue;
      }
      // Play Immediately cards and blocks are already shown, with their caption, while the cards move
      if ((e.type === 'immediate' || e.type === 'blocked') && settings.get().animSpeed !== 'off') continue;
      // A wall of yours taken or given: once per wall (the game and the card can both report the move)
      const w = !view.seats[viewer]?.bot ? wallToastFor(e, viewer) : null;
      if (w && e.card !== undefined && !wallsToasted.has(e.card)) { wallsToasted.add(e.card); newToasts.push({ id: ++toastId.current, ...w }); continue; }
      const t = toastFor(e);
      if (t) newToasts.push({ id: ++toastId.current, ...t });
    }
    if (newToasts.length) {
      setToasts(ts => [...ts, ...newToasts].slice(-4));
      const ids = new Set(newToasts.map(t => t.id));
      setTimeout(() => setToasts(ts => ts.filter(t => !ids.has(t.id))), TOAST_MS);
    }
  }, [events, view, viewer]);

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
  } else if (recap && controller.snapshot.get().passTo === null) {
    // (Pass'n'Play: the pass screen waits while cards move; the recap waits for the pass screen, so it's never seen by the wrong player)
    // Quarantined: one OK closes the recap and lets the game go on (the turn is skipped, so not "it's my turn")
    const skipped = snap.skipped != null;
    const lines = skipped ? [...recap.lines, { text: "You're in Quarantine: you drew your cards but skip the rest of this turn." }] : recap.lines;
    modal = <Recap lines={lines} myTurn={recap.myTurn && !skipped}
      onClose={() => { setRecap(null); if (skipped) controller.skipSeen(); }} />;
  } else if (snap.skipped != null && !view.over) {
    modal = <BigNotice head="QUARANTINE" title="TURN SKIPPED" sub={seatName(view, snap.skipped) + " is in Quarantine: they drew their cards but skip the rest of this turn."}
      onClose={() => controller.skipSeen()} />;
  } else if (snap.turnBanner != null && !view.over) {
    modal = <TurnBanner name={seatName(view, snap.turnBanner)} />;
  }

  return (
    <div class="btw-overlays">
      {modal}
      <Toasts toasts={toasts} />
      {/* Online: someone else is answering a question on their own device. Doesn't block the board. */}
      {snap.waitingFor && snap.waitingFor.seat !== viewer && !prompt && !view.over && (
        <div class="btw-waiting" role="status" aria-live="polite">
          <span class="btw-waiting-dots" aria-hidden="true" />
          {waitingText(snap.waitingFor, view)}
        </div>
      )}
      {tip && !modal && <TutorialTip best={tip.best} tips={tip.tips} onHide={() => setTipHidden(true)} />}
    </div>
  );
}
