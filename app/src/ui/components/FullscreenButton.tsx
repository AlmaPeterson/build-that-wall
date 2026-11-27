// The full screen button (ui/fullscreen.ts): four corners going out, or coming back in once full screen.
// Nothing shows where full screen isn't possible (iPhones, CrazyGames).
import { canFullscreen, isFullscreen, toggleFullscreen } from '../fullscreen';
import { useStore } from '../store';

const OUT = 'M3 3h7v2.6H5.6V10H3zm11 0h7v7h-2.6V5.6H14zM3 14h2.6v4.4H10V21H3zm15.4 0H21v7h-7v-2.6h4.4z';
const IN = 'M7.4 3H10v7H3V7.4h4.4zM14 3h2.6v4.4H21V10h-7zM3 14h7v7H7.4v-4.4H3zm11 0h7v2.6h-4.4V21H14z';

export function FullscreenButton({ class: cls, label }: { class: string; label?: boolean }) {
  const full = useStore(isFullscreen);
  if (!canFullscreen()) return null;
  const text = full ? 'Exit full screen' : 'Full screen';
  return (
    <button type="button" class={cls} aria-label={text} title={text} aria-pressed={full} onClick={toggleFullscreen}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={full ? IN : OUT} /></svg>
      {label && <span>{full ? 'Exit' : 'Full screen'}</span>}
    </button>
  );
}
