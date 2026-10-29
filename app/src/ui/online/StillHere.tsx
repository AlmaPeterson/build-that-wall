// "Still here?": the host hasn't heard from this device for a while. A minute to say so, or this player
// leaves the online game and goes back to the menu (with a short message). Shown over every screen.
import { useEffect, useState } from 'preact/hooks';
import '../overlays/overlays.css';
import { useStore } from '../store';
import type { OnlineSession } from './session';

export function StillHere({ session }: { session: OnlineSession }) {
  const { still, notice } = useStore(session.state);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!still) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [still]);

  if (still) {
    const secs = Math.max(0, Math.ceil((still - now) / 1000));
    return (
      <div class="btw-overlays">
        <div class="btw-ov-backdrop">
          <div class="btw-ov-frame" role="alertdialog" aria-modal="true" aria-label="Still here?">
            <div class="btw-ov-framehead">ONLINE GAME</div>
            <div class="btw-big-title">STILL HERE?</div>
            <div class="btw-big-sub">The other players haven't heard from you for a while.</div>
            <div class="btw-big-title btw-still-count" aria-live="polite">{secs}</div>
            <div class="btw-big-sub">Seconds left before you leave the game.</div>
            <div class="btw-ov-center"><button type="button" class="btw-ov-btn" autoFocus onClick={() => session.stillHere()}>Still here</button></div>
            <div class="btw-ov-foot" />
          </div>
        </div>
      </div>
    );
  }
  if (notice) {
    return (
      <div class="btw-overlays">
        <div class="btw-ov-backdrop">
          <div class="btw-ov-frame" role="alertdialog" aria-modal="true" aria-label="You left the online game">
            <div class="btw-ov-framehead">ONLINE GAME</div>
            <div class="btw-big-sub">{notice}</div>
            <div class="btw-ov-center"><button type="button" class="btw-ov-btn" autoFocus onClick={() => session.clearNotice()}>OK</button></div>
            <div class="btw-ov-foot" />
          </div>
        </div>
      </div>
    );
  }
  return null;
}
