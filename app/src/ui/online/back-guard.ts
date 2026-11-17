// The browser's Back button (or a phone's back gesture) during an online game. Without this it takes the
// player off the site: their page is often kept frozen rather than closed, so it never says goodbye, and
// everyone else waits for them. While in a room or a game, Back does what people expect instead: it closes
// the popup that's open, goes back to the game from a side screen, or asks "Leave the online game?".

const GUARD = 'btw-online-guard';

export interface BackGuardDeps {
  /** In a room or a game: Back is caught. */
  active(): boolean;
  /** Back was pressed with no popup open. */
  onBack(): void;
}

/** A popup is open that Escape closes (card popups, questions that can be cancelled, notices...). */
function openPopup(): Element | null {
  const all = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const el of Array.from(all)) {
    if (el.closest('.rotate-hint')) continue;          // the "turn your phone" screen, shown by CSS only
    if ((el as HTMLElement).getClientRects().length) return el;
  }
  return null;
}

export function installBackGuard(deps: BackGuardDeps, subscribe: (fn: () => void) => () => void): () => void {
  if (typeof window === 'undefined' || !window.history?.pushState) return () => {};
  const guarded = () => (history.state as { [GUARD]?: number } | null)?.[GUARD] === 1;
  const arm = () => { if (!guarded()) history.pushState({ [GUARD]: 1 }, ''); };

  let ownBack = false;               // the next popstate is our own history.back(), not the player's
  const sync = () => {
    if (ownBack) return;
    if (deps.active()) arm();
    // Left the room some other way (or the page was reloaded on our entry): take it off again, so Back works normally
    else if (guarded()) { ownBack = true; history.back(); }
  };
  const onPop = () => {
    if (ownBack) { ownBack = false; if (deps.active()) arm(); return; }
    if (!deps.active()) return;
    arm();                                             // stay on the page; Back can be caught again
    const popup = openPopup();
    if (popup) {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    deps.onBack();
  };

  addEventListener('popstate', onPop);
  const stop = subscribe(sync);
  sync();
  return () => { removeEventListener('popstate', onPop); stop(); };
}
