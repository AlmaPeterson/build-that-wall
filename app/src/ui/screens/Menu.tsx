// The main menu: red header with the logo, your name (tap to change it), the five main buttons, and the
// disclaimer footer with the Amazon link (like the old game's title screen). Play asks how you want to
// play (menus/PlayMenu.tsx).
import { useEffect, useState } from 'preact/hooks';
import { loadSettings } from '../../services/config';
import { screen } from '../app-state';
import { saveMyName } from '../account/my-name';
import { nameMessage } from '../account/results';
import { Button } from '../components/Button';
import { Guide } from '../menus/Guide';
import logo from '../menus/logo.png';
import { PlayMenu } from '../menus/PlayMenu';
import { initSettingsPersistence } from '../menus/prefs';
import { startTutorialGame } from '../menus/start';
import { services } from '../services';
import { useStore } from '../store';
import '../menus/menus.css';

export { AMAZON_URL, amazonUrl } from '../links';
import { amazonUrl } from '../links';

/** "Playing as Alma ✎": tap to change your name right here. */
function MyName() {
  const player = useStore(services.player);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const named = !!services.store.get('name') || player.signedIn;

  if (!editing) {
    return (
      <button type="button" class="menu__name" onClick={() => { setTyped(named ? player.name : ''); setError(''); setEditing(true); }}>
        {named ? <>Playing as <b>{player.name}</b> <span class="menu__name-edit" aria-hidden="true">✎</span></> : <>Tap to set your name <span aria-hidden="true">✎</span></>}
      </button>
    );
  }
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const r = await saveMyName(typed);
    setBusy(false);
    const said = nameMessage(r);
    if (r === 'ok' || r === 'local' || r === 'noserver') setEditing(false); else setError(said.text);
  };
  return (
    <form class="menu__name-form" onSubmit={e => void save(e)}>
      <label class="menu__name-label" for="menu-name">Your name</label>
      <input id="menu-name" type="text" maxLength={20} value={typed} autoFocus autoComplete="nickname" enterKeyHint="done"
        onInput={e => setTyped(e.currentTarget.value)} />
      <Button type="submit" disabled={busy}>Save</Button>
      <Button type="button" color="plain" onClick={() => setEditing(false)}>Cancel</Button>
      {error && <p class="menu__name-error" role="alert">{error}</p>}
    </form>
  );
}

export function MenuScreen() {
  initSettingsPersistence();
  const [play, setPlay] = useState(false);
  const [guide, setGuide] = useState(false);
  const [tag, setTag] = useState('');
  useEffect(() => {
    let live = true;
    loadSettings().then(r => { if (live) setTag(r.settings.amazonTag); }).catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <div class="menu">
      <header class="menu__head">
        <h1 class="menu__title"><img class="menu__logo" src={logo} alt="Build That Wall: Trump's political card-game" /></h1>
      </header>
      <main class="menu__main">
        <MyName />
        <Button class="menu__big" onClick={() => setPlay(true)}>Play</Button>
        <Button class="menu__big" onClick={() => screen.set('settings')}>Settings</Button>
        <Button class="menu__big" onClick={() => screen.set('account')}>Account &amp; Store</Button>
        <Button class="menu__big" onClick={() => screen.set('instructions')}>Instructions</Button>
        <Button class="menu__big" onClick={() => setGuide(true)}>Tutorial</Button>
      </main>
      <footer class="menu__foot">
        <p>Disclaimer: All scenarios and characters portrayed in the deck are purely for entertainment and comical purposes. Any likeness to persons, organizations, or events are purely coincidental.</p>
        <a href={amazonUrl(tag)} target="_blank" rel="noopener">Get BUILD THAT WALL at Amazon.com</a>
        <nav class="menu__legal" aria-label="Legal">
          <a href="./how-to-play.html">About &amp; How to Play</a><span aria-hidden="true"> · </span><a href="./privacy.html">Privacy</a><span aria-hidden="true"> · </span><a href="./terms.html">Terms &amp; Conditions</a>
        </nav>
        <small class="menu__tm">™ &amp; ® 2024 Beacon Political</small>
      </footer>
      {play && <PlayMenu onClose={() => setPlay(false)} />}
      {guide && <Guide onClose={() => setGuide(false)} finishLabel="Start a tutorial game" onFinish={startTutorialGame} />}
    </div>
  );
}
