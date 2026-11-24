// The in-game board (docs/game-rules.md sections 4-6), laid out like the old game.
// Reads the controller's snapshot; acts through controller.act. Questions the engine asks
// (blocks, targets, picks) are shown by the overlays on top of this.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CardId } from '../../data/cards';
import type { Action } from '../../game';
import { controller as controllerStore, screen, settings } from '../app-state';
import { playSfx } from '../audio';
import { Button } from '../components/Button';
import type { GameController } from '../controller';
import { animatorFor, FlightLayer } from '../anim';
import { useStore } from '../store';
import {
  canInteract, displayName, cardActions, dropAction, manHourWalls, payableWalls, type DropZone, shownHand, type CardChoice, watching,
} from './board-state';
import { ConfirmEnd } from './BoardModal';
import { online } from '../online';
import { ActionLog } from './ActionLog';
import { CardPopup } from './CardPopup';
import { WatchVideosButton } from './CardVideos';
import { cardImage } from '../assets';
import { Hand, HiddenHand } from './Hand';
import { Piles } from './Piles';
import { Scoreboard } from './Scoreboard';
import { MyWalls, OtherWalls } from './Walls';
import { showCard } from '../components/zoom';
import './board.css';
import logo from '../menus/logo.png';
import { onCG } from '../platform';

const AMAZON = 'https://www.amazon.com/Beacon-Political-Outrageously-Adults-Players/dp/B0DPCY51PJ';

/** Where a card dragged out of the hand can be dropped, in stage units (board.css .piles, .walls-mine). */
const DROP_ZONES: { zone: DropZone; x: number; y: number; w: number; h: number; label: string }[] = [
  { zone: 'discard', x: 252, y: 115, w: 50, h: 78, label: 'Play' },
  { zone: 'walls', x: 3, y: 166, w: 196, h: 47, label: 'Build' },
];

/** Picking cards from the hand after choosing "Pick 2 Walls to Discard" or "Use On Wall". */
type Picking =
  | { kind: 'walls'; slot: number; picked: number[] }       // 2 walls to pay for building `slot`
  | { kind: 'wallForManHour'; manHour: number };            // the wall to build with this Man Hour

export function Board({ controller }: { controller: GameController }) {
  const animator = animatorFor(controller);
  const { snap, idle } = useStore(animator.state);
  const { tutorial } = useStore(settings);
  const [open, setOpen] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  /** A card dragged out of the hand: which slot, where the pointer is (px from the stage's top left), and the zone it's over. */
  const [lift, setLift] = useState<{ slot: number; x: number; y: number; over: DropZone | null } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const view = snap.view;
  // Only once the board has caught up: the hand on screen must be the real one before a card is tapped
  const live = idle && canInteract(snap, busy);
  const handSeat = shownHand(snap);
  const hand: readonly CardId[] = handSeat !== null ? view?.seats[handSeat]?.hand ?? [] : [];

  // Anything half-done is dropped when it's no longer the viewer's move (or the hand changed under it)
  useEffect(() => {
    if (!live) { setPicking(null); setOpen(null); setLift(null); }
  }, [live]);
  useEffect(() => {
    if (open !== null && open >= hand.length) setOpen(null);
  }, [hand.length, open]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(t);
  }, [message]);

  if (!view) return <div class="stage board" />;

  async function act(action: Action, sfx: string) {
    setBusy(true);
    setOpen(null); setPicking(null);
    playSfx(sfx);
    try {
      const r = await controller.act(action);
      if (!r.ok && r.reason !== 'Cancelled.') setMessage(r.reason);
    } finally {
      setBusy(false);
    }
  }

  function choose(c: CardChoice) {
    setOpen(null);
    if (c.kind === 'build') void act({ type: 'build', slot: c.slot, pay: { manHour: c.manHour } }, 'build');
    else if (c.kind === 'play') void act({ type: 'play', slot: c.slot }, 'card');
    else if (c.kind === 'pickWalls') {
      // Exactly 2 other walls: nothing to pick, build with them
      const pay = payableWalls(hand, c.slot);
      if (pay.length === 2) void act({ type: 'build', slot: c.slot, pay: { walls: [pay[0]!, pay[1]!] } }, 'build');
      else setPicking({ kind: 'walls', slot: c.slot, picked: [] });
    }
    else setPicking({ kind: 'wallForManHour', manHour: c.manHour });
  }

  // Which hand slots can be picked right now
  const api = controller.api;
  const pickable = !picking ? [] : picking.kind === 'walls'
    ? payableWalls(hand, picking.slot)
    // Any wall can be built with the Man Hour that was tapped (the engine's list only pairs walls with the first Man Hour)
    : (api?.buildOptions(snap.viewer).length ? manHourWalls(hand) : []);

  function onCard(slot: number) {
    playSfx('click');
    if (!picking) { setOpen(slot); return; }
    if (picking.kind === 'wallForManHour') {
      void act({ type: 'build', slot, pay: { manHour: picking.manHour } }, 'build');
      return;
    }
    const picked = picking.picked.includes(slot) ? picking.picked.filter(s => s !== slot) : [...picking.picked, slot];
    if (picked.length === 2) void act({ type: 'build', slot: picking.slot, pay: { walls: [picked[0]!, picked[1]!] } }, 'build');
    else setPicking({ ...picking, picked });
  }

  /** The drop zone under a viewport point, if any. */
  function zoneAt(x: number, y: number): DropZone | null {
    const r = stage.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const u = r.width / 640, sx = (x - r.left) / u, sy = (y - r.top) / u;
    return DROP_ZONES.find(z => sx >= z.x && sx <= z.x + z.w && sy >= z.y && sy <= z.y + z.h)?.zone ?? null;
  }

  function onLift(slot: number, x: number, y: number, phase: 'move' | 'drop' | 'cancel') {
    const over = zoneAt(x, y);
    const r0 = stage.current?.getBoundingClientRect();
    if (phase === 'move') { setLift({ slot, x: x - (r0?.left ?? 0), y: y - (r0?.top ?? 0), over }); return; }
    setLift(null);
    if (phase === 'cancel' || !over) return;                // let go elsewhere: it goes back into the hand
    const r = dropAction(api, snap, slot, over, busy);
    if ('choice' in r) choose(r.choice);
    else if ('open' in r) { playSfx('click'); setOpen(slot); }
    else if (r.reason) setMessage(r.reason);
  }

  function endGame() {
    setConfirm(false);
    controllerStore.get()?.stop();
    controllerStore.set(null);
    screen.set('menu');
  }

  return (
    <>
    <div class="stage board" ref={stage}>
      <div class="board__header" role="banner"><img class="board__logo" src={logo} alt="Build That Wall" /></div>
      <ActionLog events={snap.events} />

      <Scoreboard state={view} />
      <Piles state={view} />
      {!watching(view, snap.viewer) ? <MyWalls state={view} seat={snap.viewer} /> : null}
      <OtherWalls state={view} viewer={watching(view, snap.viewer) ? -1 : snap.viewer} />

      {handSeat !== null
        ? snap.openHands
          ? <Hand seat={handSeat} cards={hand} onCard={() => {}} picking={null} title={displayName(view, handSeat) + "'s Hand"} />
          : <Hand seat={handSeat} cards={hand} onCard={onCard} onZoom={slot => { setOpen(null); showCard(hand[slot]); }} onLift={live && !picking ? onLift : undefined} picking={picking ? { pickable, picked: picking.kind === 'walls' ? picking.picked : [] } : null} />
        : <HiddenHand message={view.turn < 0 ? 'Dealing the cards…' : snap.turnBanner != null || snap.passTo !== null ? 'Your cards are coming up…' : undefined} />}

      {picking && (
        <div class="at pickbar" role="status">
          <span>{picking.kind === 'walls'
            ? `Pick ${2 - picking.picked.length} more ${2 - picking.picked.length === 1 ? 'wall' : 'walls'} to discard`
            : 'Pick the Wall Section to build with your Man Hour'}</span>
          <Button color="plain" onClick={() => setPicking(null)}>Cancel</Button>
        </div>
      )}
      {!picking && message && <div class="at pickbar" role="alert">{message}</div>}

      <div class="at side side--top">
        <Button class={'side__end-turn' + (live && view.actionsLeft < 1 ? ' btw-ready' : '')} disabled={!live} onClick={() => void act({ type: 'endTurn' }, 'click')}>End Turn</Button>
        <WatchVideosButton controller={controller} />
      </div>
      <BoardMenu tutorial={tutorial} onEndGame={() => (online.controller === controller ? online.askLeave() : setConfirm(true))} />


      {open !== null && hand[open] !== undefined && (
        <CardPopup card={hand[open]!} actions={cardActions(api, snap, open, busy)} onChoose={choose} onClose={() => setOpen(null)}
          onDoubleClick={() => { const id = hand[open]; setOpen(null); showCard(id); }} />
      )}
      {confirm && <ConfirmEnd onYes={endGame} onNo={() => setConfirm(false)} />}
      {lift && DROP_ZONES.map(z => {
        const r = dropAction(api, snap, lift.slot, z.zone, busy);
        const ok = 'choice' in r || 'open' in r;
        return (
          <div key={z.zone} class={`drop-zone drop-zone--${ok ? 'ok' : 'no'} ${lift.over === z.zone ? 'drop-zone--over' : ''}`}
            style={{ left: `calc(var(--u) * ${z.x})`, top: `calc(var(--u) * ${z.y})`, width: `calc(var(--u) * ${z.w})`, height: `calc(var(--u) * ${z.h})` }}>
            <span class="drop-zone__label">{ok ? z.label : ''}</span>
          </div>
        );
      })}
      {lift && hand[lift.slot] !== undefined && (
        <img class="hand-ghost" src={cardImage(hand[lift.slot]!, 'thumb')} alt="" draggable={false}
          style={{ left: `${lift.x}px`, top: `${lift.y}px`, width: `calc(var(--u) * 49)` }} />
      )}
      <FlightLayer animator={animator} />
    </div>
    {/* At the bottom of the window, however tall it is */}
    <footer class="board__footer">
      {/* No outside store links on CrazyGames */}
      {!onCG() && <a href={AMAZON} target="_blank" rel="noopener">Get BUILD THAT WALL at Amazon.com</a>}
      <small>™ &amp; ® 2024 Beacon Political</small>
    </footer>
    </>
  );
}

/** Everything that isn't playing a card, in one menu at the top right: Settings, tutorial tips, Instructions, End Game. */
function BoardMenu({ tutorial, onEndGame }: { tutorial: boolean; onEndGame: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Closes on a tap anywhere else, or Escape
  useEffect(() => {
    if (!open) return;
    const tap = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', tap); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', tap); removeEventListener('keydown', key); };
  }, [open]);
  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div class="at board__menu" ref={box}>
      <button type="button" class="board__menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v2.6H3zm0 5.7h18v2.6H3zm0 5.7h18V19H3z" /></svg>
        Menu
      </button>
      {open && (
        <div class="board__menu-list" role="menu" aria-label="Menu">
          <button type="button" role="menuitem" onClick={go(() => screen.set('settings'))}>Settings</button>
          <button type="button" role="menuitemcheckbox" aria-checked={tutorial}
            onClick={() => settings.update(s => ({ ...s, tutorial: !s.tutorial }))}>
            Tutorial tips<span class={'board__menu-switch' + (tutorial ? ' is-on' : '')}>{tutorial ? 'On' : 'Off'}</span>
          </button>
          <button type="button" role="menuitem" onClick={go(() => screen.set('instructions'))}>Instructions</button>
          <button type="button" role="menuitem" class="board__menu-end" onClick={go(onEndGame)}>End Game</button>
        </div>
      )}
    </div>
  );
}
