// "Who's playing?": Pass'n'Play (the Play box) asks each person's name, so the game says "Sam's turn",
// not "Player 2's turn". The names are kept in the settings for next time.
import { useState } from 'preact/hooks';
import { browserStorage, SaveStore } from '../../services/storage';
import { cleanName } from '../../services/online';
import { settings } from '../app-state';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { MAX_PLAYERS, updateSettings } from './prefs';
import { playerOneName } from './start';

/** How many people are playing on this device with the current settings. */
export function humansPlaying(): number {
  const g = settings.get().game;
  return Math.max(0, g.players - Math.min(g.bots, g.players));
}

export function PlayerNames({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const humans = humansPlaying();
  const saved = settings.get().game.names;
  const [names, setNames] = useState(() => Array.from({ length: humans }, (_, k) => saved[k] || (k === 0 ? playerOneName() : '')));

  function start(e?: Event) {
    e?.preventDefault();
    const typed = names.map(n => n.trim().slice(0, 20));
    updateSettings(s => ({ ...s, game: { ...s.game, names: Array.from({ length: MAX_PLAYERS }, (_, j) => (j < humans ? typed[j]! : s.game.names[j] ?? '')) } }));
    // Player 1 is this device's identity (your name on the home page): online play and scores use the same name
    if (typed[0]) new SaveStore(browserStorage()).set('name', cleanName(typed[0]));
    onStart();
  }

  return (
    <Modal title="Who's playing?" onClose={onClose}>
      <form class="names" onSubmit={start}>
        <p class="names__about">Type each player's name. The game will use them when it's someone's turn.</p>
        {names.map((name, k) => (
          <label class="names__row" key={k}>
            <span class="names__label">Player {k + 1}</span>
            <input type="text" maxLength={20} value={name} placeholder={'Player ' + (k + 1)} autoComplete="off" enterKeyHint={k === humans - 1 ? 'go' : 'next'}
              onInput={e => { const v = e.currentTarget.value; setNames(n => n.map((x, j) => (j === k ? v : x))); }} />
          </label>
        ))}
        <div class="names__buttons">
          <Button type="submit">Start</Button>
          <Button color="plain" type="button" onClick={onClose}>Back</Button>
        </div>
      </form>
    </Modal>
  );
}
