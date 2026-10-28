// The main menu: red header with the logo, the five main buttons, and the
// disclaimer footer with the Amazon link (like the old game's title screen).
import { useEffect, useState } from 'preact/hooks';
import { loadSettings } from '../../services/config';
import { screen, settings } from '../app-state';
import { Button } from '../components/Button';
import { Guide } from '../menus/Guide';
import logo from '../menus/logo.png';
import { MultiplayerMenu } from '../menus/MultiplayerMenu';
import { initSettingsPersistence } from '../menus/prefs';
import { startPassNPlay, startTutorialGame } from '../menus/start';
import { useStore } from '../store';
import '../menus/menus.css';

export const AMAZON_URL = 'https://www.amazon.com/Beacon-Political-Outrageously-Adults-Players/dp/B0DPCY51PJ';

/** The store link, with the owner's Amazon tag from game-settings.json when there is one. */
export const amazonUrl = (tag: string): string => (tag ? AMAZON_URL + '?tag=' + encodeURIComponent(tag) : AMAZON_URL);

export function MenuScreen() {
  initSettingsPersistence();
  const { gameMode } = useStore(settings);
  const [multi, setMulti] = useState(false);
  const [guide, setGuide] = useState(false);
  const [tag, setTag] = useState('');  useEffect(() => {
    let live = true;
    loadSettings().then(r => { if (live) setTag(r.settings.amazonTag); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const start = () => (gameMode === 'multiplayer' ? setMulti(true) : startPassNPlay());

  return (
    <div class="menu">
      <header class="menu__head">
        <img class="menu__logo" src={logo} alt="Build That Wall: Trump's political card-game" />
      </header>
      <main class="menu__main">
        <Button class="menu__big" onClick={start}>Start Game</Button>
        <Button class="menu__big" onClick={() => screen.set('settings')}>Settings</Button>
        <Button class="menu__big" onClick={() => screen.set('account')}>Account &amp; Store</Button>
        <Button class="menu__big" onClick={() => screen.set('instructions')}>Instructions</Button>
        <Button class="menu__big" onClick={() => setGuide(true)}>Tutorial</Button>
      </main>
      <footer class="menu__foot">
        <p>Disclaimer: All scenarios and characters portrayed in the deck are purely for entertainment and comical purposes. Any likeness to persons, organizations, or events are purely coincidental.</p>
        <a href={amazonUrl(tag)} target="_blank" rel="noopener">Get BUILD THAT WALL at Amazon.com</a>
        <small class="menu__tm">™ &amp; ® 2024 Beacon Political</small>
      </footer>
      {multi && <MultiplayerMenu onClose={() => setMulti(false)} />}
      {guide && <Guide onClose={() => setGuide(false)} finishLabel="Start a tutorial game" onFinish={startTutorialGame} />}
    </div>
  );
}
