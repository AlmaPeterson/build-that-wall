// Settings: how the app looks and sounds (sound, music, tutorial tips, card animations, text sizes). How a
// game is set up (players, bots, how it ends, names) is asked when you press Play (menus/PlayMenu.tsx),
// and your name is on the home page. Changes are saved straight away (menus/prefs.ts).
import { useRef } from 'preact/hooks';
import { settings, type AnimSpeed, type TextArea, type UiSettings, goBack } from '../app-state';
import { Button } from '../components/Button';
import { Row, Toggle } from '../menus/controls';
import { initSettingsPersistence, TEXT_STEPS, updateSettings } from '../menus/prefs';
import { useStore } from '../store';
import '../menus/menus.css';

const TEXT_AREAS: { area: TextArea; title: string; about: string }[] = [
  { area: 'popups', title: 'Messages and choice lists', about: 'The boxes that tell you what happened, and the lists you pick from.' },
  { area: 'board', title: 'Scoreboard and game screen', about: 'Names, miles and other words on the game screen.' },
  { area: 'cards', title: 'Cards in your hand', about: 'Makes your cards, and the words printed on them, bigger.' },
  { area: 'menu', title: 'Menus, windows and guides', about: 'The main menu, Settings, Instructions and the guide.' },
];

const set = (patch: Partial<UiSettings>) => updateSettings(s => ({ ...s, ...patch }));

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
  return (
    <div class="page">
      {/* Done at the top too: on phones a button at the very bottom edge can be hard to tap (the browser's toolbar takes the tap) */}
      <header class="page__head page__head--with-done"><h1>Settings</h1><Button class="page__done" onClick={goBack}>Done</Button></header>
      <main class="page__main settings">
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
