// Settings (docs/game-rules.md section 2): game mode, players, bots and their difficulty, how the game
// ends, sound, music, names and text sizes. Changes are saved straight away (menus/prefs.ts).
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import type { Ending } from '../../game';
import { controller, screen, settings, type AnimSpeed, type TextArea, type UiSettings, goBack } from '../app-state';
import { Button } from '../components/Button';
import {
  ENDING_NAMES, initSettingsPersistence, MAX_PLAYERS, MIN_PLAYERS, TEXT_STEPS, updateSettings, type BotLevel,
} from '../menus/prefs';
import { playerOneName } from '../menus/start';
import { SaveStore, browserStorage } from '../../services/storage';
import { cleanName } from '../../services/online';
import { useStore } from '../store';
import '../menus/menus.css';

const LEVELS: { value: BotLevel; name: string }[] = [
  { value: 'easy', name: 'Easy' }, { value: 'medium', name: 'Medium' }, { value: 'hard', name: 'Hard' }, { value: 'random', name: 'Random' },
];

const TEXT_AREAS: { area: TextArea; title: string; about: string }[] = [
  { area: 'popups', title: 'Messages and choice lists', about: 'The boxes that tell you what happened, and the lists you pick from.' },
  { area: 'board', title: 'Scoreboard and game screen', about: 'Names, miles and other words on the game screen.' },
  { area: 'cards', title: 'Cards in your hand', about: 'Makes your cards, and the words printed on them, bigger.' },
  { area: 'menu', title: 'Menus, windows and guides', about: 'The main menu, Settings, Instructions and the guide.' },
];

const setGame = (patch: Partial<UiSettings['game']>) => updateSettings(s => ({ ...s, game: { ...s.game, ...patch } }));
const set = (patch: Partial<UiSettings>) => updateSettings(s => ({ ...s, ...patch }));

function Row({ label, children, id }: { label: string; children: ComponentChildren; id?: string }) {
  return (
    <div class="settings__row">
      <label class="settings__label" for={id}>{label}</label>
      <div class="settings__control">{children}</div>
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span class="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={label + ' fewer'} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={label + ' more'} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)}>
      {on ? 'On' : 'Off'}
    </button>
  );
}

/** How many times `value` has changed since the screen opened. */
function useChangeCount<T>(value: T): number {
  const count = useRef(0);
  const last = useRef(value);
  if (value !== last.current) { last.current = value; count.current++; }
  return count.current;
}

export function SettingsScreen() {
  initSettingsPersistence();
  const s = useStore(settings);
  const saves = useChangeCount(s);
  const running = useStore(controller)?.state;
  const g = s.game;
  const humans = g.players - g.bots;
  return (
    <div class="page">
      <header class="page__head"><h1>Settings</h1></header>
      <main class="page__main settings">
        {running && !running.over && <p class="settings__notice">A game is running: changes to players, bots and how the game ends start with your next game. Everything else changes now.</p>}

        <Row label="Game Mode" id="set-mode">
          <select id="set-mode" value={s.gameMode} onChange={e => set({ gameMode: (e.currentTarget.value as UiSettings['gameMode']) })}>
            <option value="passnplay">Pass'n'Play</option>
            <option value="multiplayer">Multiplayer</option>
          </select>
        </Row>
        <Row label="Players">
          <Stepper label="Players" value={g.players} min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={players => setGame({ players })} />
        </Row>
        {/* Online only: keep trying to join a room that isn't open yet */}
        {s.gameMode === 'multiplayer' && (
          <Row label="Auto Join"><Toggle label="Auto Join" on={s.autoJoin} onChange={autoJoin => set({ autoJoin })} /></Row>
        )}
        <Row label="AI Players">
          <Stepper label="AI Players" value={g.bots} min={0} max={g.players} onChange={bots => setGame({ bots })} />
          {g.bots === g.players && <span class="settings__hint">Watch mode: bots only</span>}
        </Row>
        {Array.from({ length: g.bots }, (_, k) => (
          <Row key={k} label={`Bot ${k + 1} difficulty`} id={`set-ai${k + 1}`}>
            <select id={`set-ai${k + 1}`} value={g.difficulties[k] ?? 'easy'}
              onChange={e => setGame({ difficulties: g.difficulties.map((d, j) => (j === k ? e.currentTarget.value as BotLevel : d)) })}>
              {LEVELS.map(l => <option key={l.value} value={l.value}>{l.name}</option>)}
            </select>
          </Row>
        ))}
        <Row label="Ending" id="set-ending">
          <select id="set-ending" value={String(g.ending)} onChange={e => setGame({ ending: Number(e.currentTarget.value) as Ending })}>
            {([1, 2, 3, 4] as Ending[]).map(n => <option key={n} value={String(n)}>{ENDING_NAMES[n]}</option>)}
          </select>
        </Row>
        {g.ending !== 1 && (
          <Row label="Ending Times" id="set-times">
            <select id="set-times" value={String(g.endingTimes)} onChange={e => setGame({ endingTimes: e.currentTarget.value === '2' ? 2 : 1 })}>
              <option value="1">Draw pile runs out once</option>
              <option value="2">Draw pile runs out twice</option>
            </select>
          </Row>
        )}
        {Array.from({ length: humans }, (_, k) => (
          <Row key={'n' + k} label={`Player ${k + 1} name`} id={`set-name${k}`}>
            <input id={`set-name${k}`} type="text" maxLength={20} placeholder={(k === 0 && playerOneName()) || `Player ${k + 1}`} value={g.names[k] ?? ''}
              onInput={e => {
                const name = e.currentTarget.value;
                setGame({ names: Array.from({ length: MAX_PLAYERS }, (_, j) => (j === k ? name : g.names[j] ?? '')) });
                // Player 1 is this device's identity. Keep online play, scores and Account & Store in sync.
                if (k === 0) new SaveStore(browserStorage()).set('name', cleanName(name));
              }} />
          </Row>
        ))}
        <Row label="Sound Effects"><Toggle label="Sound Effects" on={s.sound} onChange={sound => set({ sound })} /></Row>
        <Row label="Music Mode" id="set-music">
          <select id="set-music" value={s.musicMode} onChange={e => set({ musicMode: e.currentTarget.value === 'one' ? 'one' : 'cycle' })}>
            <option value="cycle">Cycle All</option>
            <option value="one">Play One</option>
          </select>
        </Row>
        <Row label="Tutorial tips"><Toggle label="Tutorial tips" on={s.tutorial} onChange={tutorial => set({ tutorial })} /></Row>
        <Row label="Card animations" id="set-anim">
          <select id="set-anim" value={s.animSpeed} onChange={e => set({ animSpeed: e.currentTarget.value as AnimSpeed })}>
            <option value="slow">Slow</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
            <option value="off">Off</option>
          </select>
        </Row>

        <h2 class="settings__section">Text size</h2>
        {TEXT_AREAS.map(({ area, title, about }) => (
          <div class="settings__text" key={area}>
            <div class="settings__label">{title}</div>
            <div class="settings__about">{about}</div>
            <div class="settings__steps" role="radiogroup" aria-label={title}>
              {TEXT_STEPS[area].map(step => (
                <button type="button" role="radio" key={step.name} aria-checked={s.textSizes[area] === step.value}
                  class={s.textSizes[area] === step.value ? 'is-current' : ''}
                  onClick={() => set({ textSizes: { ...s.textSizes, [area]: step.value } })}>{step.name}</button>
              ))}
            </div>
          </div>
        ))}
        <Button color="plain" onClick={() => set({ textSizes: { menu: 1, board: 1, cards: 1, popups: 1 } })}>Reset text sizes to normal</Button>
      </main>
      <footer class="page__foot">
        {/* Saved as you go: say so, and show it each time something changes */}
        <span class="settings__saved" key={saves} aria-live="polite">{saves ? '✓ Saved' : '✓ Changes are saved as you make them'}</span>
        <Button onClick={goBack}>Done</Button>
      </footer>
    </div>
  );
}
