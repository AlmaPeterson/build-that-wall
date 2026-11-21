// The in-game screen: the board with the overlays (questions, pass screen, win screen...) on top.
import { controller as controllerStore, screen } from '../app-state';
import { Board } from '../board/Board';
import { CardVideos } from '../board/CardVideos';
import { CardZoom } from '../board/CardZoom';
import { startDemoFromUrl } from '../board/demo';
import { Button } from '../components/Button';
import { Overlays } from '../overlays/Overlays';
import { useStore } from '../store';
import { endReplay, ReplayController } from '../replay';

// ?demo in the address starts a game straight away (a dev helper; see board/demo.ts)
startDemoFromUrl();

export function GameScreen() {
  const c = useStore(controllerStore);
  if (!c) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <h1>No game running</h1>
        <Button onClick={() => screen.set('menu')}>Back to the menu</Button>
      </div>
    );
  }
  return (
    <div class="game-screen">
      <Board controller={c} />
      <Overlays controller={c} />
      {c instanceof ReplayController && <ReplayBar c={c} />}
      <CardZoom />
      <CardVideos controller={c} />
      <RotateHint />
    </div>
  );
}

/** The replay's controls: back, play or pause, next, which turn, and leave. */
function ReplayBar({ c }: { c: ReplayController }) {
  const { frame, playing } = useStore(c.at);
  const last = c.frames - 1;
  return (
    <div class="replay-bar" role="toolbar" aria-label="Replay">
      <b class="replay-bar__title">REPLAY</b>
      <Button color="plain" aria-label="First turn" disabled={frame <= 0} onClick={() => { c.pause(); c.goto(0); }}>⏮</Button>
      <Button color="plain" aria-label="Back one turn" disabled={frame <= 0} onClick={() => { c.pause(); c.back(); }}>◀</Button>
      <Button aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? c.pause() : c.play())}>{playing ? '❚❚ Pause' : '▶ Play'}</Button>
      <Button color="plain" aria-label="Next turn" disabled={frame >= last} onClick={() => { c.pause(); c.next(); }}>▶</Button>
      <Button color="plain" aria-label="Last turn" disabled={frame >= last} onClick={() => { c.pause(); c.goto(last); }}>⏭</Button>
      <span class="replay-bar__at" aria-live="polite">{frame >= last ? 'The end' : 'Turn ' + (frame + 1) + ' of ' + last}</span>
      <Button color="plain" onClick={endReplay}>Exit replay</Button>
    </div>
  );
}

/**
 * On a phone held upright (CSS shows it only then): turn the phone sideways. Where the browser allows it
 * (Android), a button goes full screen and turns the game sideways by itself.
 */
function RotateHint() {
  const canFull = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
  const fullScreen = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await (globalThis.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape');
    } catch { /* not allowed here: turning the phone still works */ }
  };
  return (
    <div class="rotate-hint" role="dialog" aria-label="Turn your phone sideways">
      <svg class="rotate-hint__phone" viewBox="0 0 90 90" aria-hidden="true">
        <rect x="27" y="8" width="36" height="74" rx="7" fill="none" stroke="#fff" stroke-width="5" />
        <rect x="35" y="16" width="20" height="54" rx="2" fill="#fff" opacity=".35" />
        <circle cx="45" cy="76" r="2.5" fill="#fff" />
      </svg>
      <h2>Turn your phone sideways</h2>
      <p>The game board is wide. Hold your phone sideways to play; your game is waiting.</p>
      {canFull && <Button onClick={() => void fullScreen()}>Play full screen</Button>}
    </div>
  );
}
