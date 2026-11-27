// While you wait for your turn: "Watch videos" shows every card, and a card opens the page its QR code links to
// (each card's video), right here in the game. When the game needs you again, the device vibrates and dings,
// and the popup's X turns green and wiggles until you close it.
// Closing a card's page with the X only hides it: "Watch videos" brings that page back exactly where you left the
// video (the page lives on another site, so the game can't pause it; the page says to pause first). Going back to
// "All cards" or to a new game lets it go.
import { useEffect, useRef, useState } from 'preact/hooks';
import { catalogue, type CardId } from '../../data/cards';
import { playDing } from '../audio';
import { cardImage } from '../assets';
import { Button } from '../components/Button';
import type { GameController, GameSnapshot } from '../controller';
import { createStore, useStore } from '../store';
import './card-videos.css';

/** The videos are open (the gallery, or one card's page). */
export const videosOpen = createStore<CardId | 'all' | null>(null);

/** The card page kept (hidden) after you closed it with the X, to carry on from there. Only for this game. */
export const keptCard = createStore<CardId | null>(null);

/** "Watch videos": back to the card you were watching, or every card. */
export function openVideos(): void {
  videosOpen.set(keptCard.get() ?? 'all');
}

/** Show a card's page in the game (the gallery, and every card popup's Scan QR Code); any page kept from before is let go. */
export function openCard(id: CardId): void {
  keptCard.set(id);
  videosOpen.set(id);
}

/** Every card with a page to show (its QR code's link), in card order. */
export const VIDEO_CARDS = catalogue.cards.filter(c => !!c.link);

/** Is the game waiting for someone on this device to do something? */
export function needsMe(snap: GameSnapshot): boolean {
  const v = snap.view;
  if (!v || v.over || snap.openHands) return false;
  if (snap.prompt || snap.passTo !== null) return true;
  if (snap.turnBanner != null) return snap.turnBanner === snap.viewer;
  return v.turn === snap.viewer && !v.seats[snap.viewer]?.bot;
}

/** Waited at least this long: then it's worth a buzz and a ding when it's your move again. */
const WAITED_MS = 3000;

/** Your move again after waiting: vibrate and ding, once. Returns whether the game needs you now. */
function useYourMove(controller: GameController): boolean {
  const snap = useStore(controller.snapshot);
  const mine = needsMe(snap);
  const waitingSince = useRef<number | null>(mine ? null : Date.now());
  useEffect(() => {
    if (!mine) { waitingSince.current ??= Date.now(); return; }
    const since = waitingSince.current;
    waitingSince.current = null;
    if (since === null || Date.now() - since < WAITED_MS) return;
    try { navigator.vibrate?.([180, 80, 180]); } catch { /* no vibration here */ }
    playDing();
  }, [mine]);
  return mine;
}

/** The button under End Turn, shown while you wait. */
export function WatchVideosButton({ controller }: { controller: GameController }) {
  const mine = needsMe(useStore(controller.snapshot));
  const over = !!useStore(controller.snapshot).view?.over;
  if (mine || over) return null;
  return <Button color="gold" class="side__videos" onClick={openVideos}>Watch videos</Button>;
}

/** The gallery and a card's page, over the whole screen. Also buzzes and dings when it's your move again. */
export function CardVideos({ controller }: { controller: GameController }) {
  const open = useStore(videosOpen);
  const kept = useStore(keptCard);
  const yourMove = useYourMove(controller);
  // A finished or ended game closes them, and forgets the card you were watching
  useEffect(() => () => { videosOpen.set(null); keptCard.set(null); }, [controller]);
  if (open === null && kept === null) return null;
  // The X closes everything; a card's page stays (hidden) so the video can carry on later
  const close = (
    <button type="button" class={'videos__x' + (yourMove ? ' videos__x--go' : '')} aria-label={yourMove ? "Close: it's your move" : 'Close'}
      title={yourMove ? "It's your move!" : 'Close'} onClick={() => videosOpen.set(null)}>✕</button>
  );
  const hidden = open === null;
  return (
    <div class={'videos' + (hidden ? ' videos--hidden' : '')} role="dialog" aria-modal={!hidden} aria-hidden={hidden}
      aria-label={open === 'all' ? 'Card videos' : 'Card page'}>
      {open === 'all' && <Gallery close={close} yourMove={yourMove} />}
      {kept !== null && open !== 'all' && <CardPage key={kept} id={kept} close={close} yourMove={yourMove} />}
    </div>
  );
}

function YourMove({ show }: { show: boolean }) {
  return show ? <p class="videos__go" role="alert">It's your move! Close this to play.</p> : null;
}

function Gallery({ close, yourMove }: { close: preact.JSX.Element; yourMove: boolean }) {
  return (
    <div class="videos__box">
      <header class="videos__head"><h2>Card videos</h2>{close}</header>
      <YourMove show={yourMove} />
      <p class="videos__about">Tap a card to watch its video and read more about it.</p>
      <ul class="videos__grid">
        {VIDEO_CARDS.map(c => (
          <li key={c.id}>
            <button type="button" onClick={() => openCard(c.id)}>
              <img src={cardImage(c.id, 'thumb')} alt="" loading="lazy" />
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardPage({ id, close, yourMove }: { id: CardId; close: preact.JSX.Element; yourMove: boolean }) {
  const card = catalogue.cards.find(c => c.id === id);
  const [loaded, setLoaded] = useState(false);
  if (!card?.link) return null;
  return (
    <div class="videos__box videos__box--page">
      <header class="videos__head">
        <button type="button" class="videos__back" onClick={() => { keptCard.set(null); videosOpen.set('all'); }}>‹ All cards</button>
        <h2>{card.name}</h2>
        {close}
      </header>
      <YourMove show={yourMove} />
      <div class="videos__frame">
        {!loaded && <p class="videos__loading">Loading…</p>}
        <iframe src={card.link} title={card.name + ' video'} allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen referrerpolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(true)} />
      </div>
      <p class="videos__out">
        Pause the video before you close this: next time you tap Watch videos, it carries on from there.{' '}
        <a href={card.link} target="_blank" rel="noopener">Not showing? Open it in a new tab</a>
      </p>
    </div>
  );
}
