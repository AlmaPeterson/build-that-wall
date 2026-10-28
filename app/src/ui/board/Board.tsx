// The in-game board (docs/game-rules.md sections 4-6), laid out like the old game.
// Reads the controller's snapshot; acts through controller.act. Questions the engine asks
// (blocks, targets, picks) are shown by the overlays on top of this.
import { useEffect, useState } from 'preact/hooks';
import type { CardId } from '../../data/cards';
import type { Action, GameEvent, GameState } from '../../game';
import { controller as controllerStore, screen, settings } from '../app-state';
import { playSfx } from '../audio';
import { Button } from '../components/Button';
import type { GameController } from '../controller';
import { animatorFor, FlightLayer } from '../anim';
import { useStore } from '../store';
import {
  buildMenu, canInteract, cardActions, manHourWalls, payableWalls, shownHand, type CardChoice,
} from './board-state';
import { BuildMenu, ConfirmEnd } from './BoardModal';
import { ActionLog } from './ActionLog';
import { resetHandOrders } from './hand-order';
import { CardPopup } from './CardPopup';
import { Hand, HiddenHand } from './Hand';
import { Piles } from './Piles';
import { Scoreboard } from './Scoreboard';
import { MyWalls, OtherWalls } from './Walls';
import './board.css';

const AMAZON = 'https://www.amazon.com/Beacon-Political-Outrageously-Adults-Players/dp/B0DPCY51PJ';
const HEADER_IMAGE = 'assets/stage/page.svg';
const QUIET: readonly string[] = ['deal', 'draw', 'turnStart', 'turnEnd', 'gameStart'];   // not shown in the hidden hand

/** Picking cards from the hand after choosing "Pick 2 Walls to Discard" or "Use On Wall". */
type Picking =
  | { kind: 'walls'; slot: number; picked: number[] }       // 2 walls to pay for building `slot`
  | { kind: 'wallForManHour'; manHour: number };            // the wall to build with this Man Hour

/** The last thing a bot did, for the log line and the hidden-hand picture. */
function lastBotEvent(state: GameState, events: readonly GameEvent[]): GameEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'turnStart' && e.seat !== undefined && !state.seats[e.seat]?.bot) return null;
    if (QUIET.includes(e.type) || e.seat === undefined) continue;
    if (state.seats[e.seat]?.bot) return e;
  }
  return null;
}

export function Board({ controller }: { controller: GameController }) {
  const animator = animatorFor(controller);
  const { snap, idle } = useStore(animator.state);
  const { tutorial } = useStore(settings);
  const [open, setOpen] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const view = snap.view;
  // Only once the board has caught up: the hand on screen must be the real one before a card is tapped
  const live = idle && canInteract(snap, busy);
  const handSeat = shownHand(snap);
  const hand: readonly CardId[] = handSeat !== null ? view?.seats[handSeat]?.hand ?? [] : [];

  // A new game: hands are shown in the order they were dealt
  useEffect(() => { resetHandOrders(); }, [controller]);

  // Anything half-done is dropped when it's no longer the viewer's move (or the hand changed under it)
  useEffect(() => {
    if (!live) { setPicking(null); setMenu(false); setOpen(null); }
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
    setOpen(null); setMenu(false); setPicking(null);
    playSfx(sfx);
    try {
      const r = await controller.act(action);
      if (!r.ok && r.reason !== 'Cancelled.') setMessage(r.reason);
    } finally {
      setBusy(false);
    }
  }

  function choose(c: CardChoice) {
    setOpen(null); setMenu(false);
    if (c.kind === 'build') void act({ type: 'build', slot: c.slot, pay: { manHour: c.manHour } }, 'build');
    else if (c.kind === 'play') void act({ type: 'play', slot: c.slot }, 'card');
    else if (c.kind === 'pickWalls') setPicking({ kind: 'walls', slot: c.slot, picked: [] });
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

  function endGame() {
    setConfirm(false);
    controllerStore.get()?.stop();
    controllerStore.set(null);
    screen.set('menu');
  }

  const botEvent = lastBotEvent(view, snap.events);
  const running = !view.over;

  return (
    <>
    <div class="stage board">
      <div class="board__header" style={{ backgroundImage: `url(${HEADER_IMAGE})` }} role="banner" aria-label="Build That Wall" />
      {running && <ActionLog events={snap.events} />}

      <Scoreboard state={view} />
      <Piles state={view} />
      {handSeat !== null || !view.seats[snap.viewer]?.bot ? <MyWalls state={view} seat={snap.viewer} /> : null}
      <OtherWalls state={view} viewer={view.seats[snap.viewer]?.bot ? -1 : snap.viewer} />

      {handSeat !== null
        ? <Hand seat={handSeat} cards={hand} onCard={onCard} picking={picking ? { pickable, picked: picking.kind === 'walls' ? picking.picked : [] } : null} />
        : <HiddenHand lastCard={view.turn < 0 || snap.turnBanner != null ? null : botEvent?.card ?? null}
            message={view.turn < 0 ? 'Dealing the cards…' : snap.turnBanner != null || snap.passTo !== null ? 'Your cards are coming up…' : undefined} />}

      {picking && (
        <div class="at pickbar" role="status">
          <span>{picking.kind === 'walls'
            ? `Pick ${2 - picking.picked.length} more ${2 - picking.picked.length === 1 ? 'wall' : 'walls'} to discard`
            : 'Pick the Wall Section to build with your Man Hour'}</span>
          <Button color="plain" onClick={() => setPicking(null)}>Cancel</Button>
        </div>
      )}
      {!picking && message && <div class="at pickbar" role="alert">{message}</div>}

      <div class="at side">
        <Button onClick={() => setConfirm(true)}>End Game</Button>
        <Button disabled={!live} onClick={() => void act({ type: 'endTurn' }, 'click')}>End Turn</Button>
        <Button disabled={!live} onClick={() => { playSfx('click'); setMenu(true); }}>Build Wall</Button>
        <Button onClick={() => screen.set('settings')}>Settings</Button>
        <Button color={tutorial ? 'gold' : 'red'} aria-pressed={tutorial}
          onClick={() => settings.update(s => ({ ...s, tutorial: !s.tutorial }))}>Tutorial</Button>
        <Button onClick={() => screen.set('instructions')}>Instructions</Button>
      </div>


      {open !== null && hand[open] !== undefined && (
        <CardPopup card={hand[open]!} actions={cardActions(api, snap, open, busy)} onChoose={choose} onClose={() => setOpen(null)} />
      )}
      {menu && <BuildMenu options={buildMenu(api, snap, busy)} onChoose={choose} onClose={() => setMenu(false)} />}
      {confirm && <ConfirmEnd onYes={endGame} onNo={() => setConfirm(false)} />}
      <FlightLayer animator={animator} />
    </div>
    {/* At the bottom of the window, however tall it is */}
    <footer class="board__footer">
      <a href={AMAZON} target="_blank" rel="noopener">Get BUILD THAT WALL at Amazon.com</a>
      <small>™ &amp; ® 2024 Beacon Political</small>
    </footer>
    </>
  );
}
