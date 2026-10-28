// How to Play: the four rules pages, plus the illustrated guide.
import { useState } from 'preact/hooks';
import { screen, goBack } from '../app-state';
import { Button } from '../components/Button';
import { Guide } from '../menus/Guide';
import { INSTRUCTION_PAGES } from '../menus/instructions';
import { startTutorialGame } from '../menus/start';
import '../menus/menus.css';

export function InstructionsScreen() {
  const [i, setI] = useState(0);
  const [guide, setGuide] = useState(false);
  const p = INSTRUCTION_PAGES[i]!;
  const List = p.numbered ? 'ol' : 'ul';
  return (
    <div class="page">
      <header class="page__head"><h1>How to Play: {p.title}</h1></header>
      <main class="page__main instructions">
        <List>{p.points.map(t => <li key={t}>{t}</li>)}</List>
        <p class="instructions__more">
          <Button color="navy" onClick={() => setGuide(true)}>Illustrated guide</Button>
        </p>
      </main>
      <footer class="page__foot">
        <Button color="plain" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => setI(i - 1)}>◀ Back</Button>
        <span>Page {i + 1} of {INSTRUCTION_PAGES.length}</span>
        {i < INSTRUCTION_PAGES.length - 1
          ? <Button onClick={() => setI(i + 1)}>Next ▶</Button>
          : <Button onClick={goBack}>Done</Button>}
        <Button color="plain" onClick={goBack}>Back</Button>
      </footer>
      {guide && <Guide onClose={() => setGuide(false)} finishLabel="Start a tutorial game" onFinish={startTutorialGame} />}
    </div>
  );
}
