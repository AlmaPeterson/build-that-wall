// The in-game screen: the board with the overlays (questions, pass screen, win screen...) on top.
import { Coach } from '../coach';
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
      <Coach />
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
