// The in-game screen: the board with the overlays (questions, pass screen, win screen...) on top.
import { controller as controllerStore, screen } from '../app-state';
import { Board } from '../board/Board';
import { CardZoom } from '../board/CardZoom';
import { startDemoFromUrl } from '../board/demo';
import { Button } from '../components/Button';
import { Overlays } from '../overlays/Overlays';
import { useStore } from '../store';

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
      <CardZoom />
    </div>
  );
}
