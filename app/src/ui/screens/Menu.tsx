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
import { Bell, VersionBadge } from '../menus/Corners';
import { FixList } from '../menus/FixList';
import { notices } from '../notifications';
import logo from '../menus/logo.png';
import { PlayMenu } from '../menus/PlayMenu';
import { initSettingsPersistence } from '../menus/prefs';
import { startTutorialGame } from '../menus/start';
import { services } from '../services';
import { useStore } from '../store';
import { Modal } from '../components/Modal';
import { deleteParked, loadParked, parkedGames, parkedTitle, resumeParked } from '../saved-game';
import '../menus/menus.css';
import '../account/pages.css';

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
      <button type="button" class={'menu__name' + (named ? '' : ' menu__name--unset')} onClick={() => { setTyped(named ? player.name : ''); setError(''); setEditing(true); }}>
        {named
          ? <>Playing as {player.gold && <b class="btw-gold-star" title="Gold member">★ </b>}<b>{player.name}</b> <span class="menu__name-edit" aria-hidden="true">✎</span></>
          // Not required, but easy to spot: without it other players see "Player 2" online and on the leaderboard
          : <><span class="menu__name-ask">✎ Set your name</span><span class="menu__name-why">So other players know who you are. You're <b>{player.name}</b> for now.</span></>}
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

/** Gold: the games put aside when another one started. Carry one on, or throw it away. */
function SavedGames({ onClose }: { onClose: () => void }) {
  const list = useStore(parkedGames);
  return (
    <Modal title="Saved games" onClose={onClose}>
      <div class="saved-games">
        <p class="btw-muted">Gold keeps up to 5 games going. Starting a new game puts the one you were playing here.</p>
        {list.length === 0 && <p>No saved games.</p>}
        <ul class="btw-list">
          {list.map(g => (
            <li key={g.id}>
              <span>{parkedTitle(g)}</span>
              <span class="btw-row">
                <Button onClick={() => { onClose(); resumeParked(g.id); }}>Continue</Button>
                <Button color="plain" aria-label={'Delete ' + parkedTitle(g)} onClick={() => deleteParked(g.id)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
        <div class="play__buttons"><Button color="plain" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

export function MenuScreen() {
  initSettingsPersistence();
  const [play, setPlay] = useState(false);
  const [guide, setGuide] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fixList, setFixList] = useState(false);
  // Only on the owner's account (the server said so); the list itself has no link anyone could type
  const { owner } = useStore(notices);
  const parked = useStore(parkedGames);
  useEffect(() => { parkedGames.set(loadParked()); }, []);
  const [tag, setTag] = useState('');
  useEffect(() => {
    let live = true;
    loadSettings().then(r => { if (live) setTag(r.settings.amazonTag); }).catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <div class="menu">
      <header class="menu__head">
        <VersionBadge />
        <Bell />
        <h1 class="menu__title"><img class="menu__logo" src={logo} alt="Build That Wall: Trump's political card-game" /></h1>
      </header>
      <main class="menu__main">
        <MyName />
        <Button class="menu__big" onClick={() => setPlay(true)}>Play</Button>
        {parked.length > 0 && <Button class="menu__big" color="gold" onClick={() => setSaved(true)}>Saved games ({parked.length})</Button>}
        <Button class="menu__big" onClick={() => screen.set('settings')}>Settings</Button>
        <Button class="menu__big" onClick={() => screen.set('account')}>Account &amp; Store</Button>
        <Button class="menu__big" onClick={() => setGuide(true)}>Tutorial</Button>
      </main>
      <footer class="menu__foot">
        <p>Disclaimer: All scenarios and characters portrayed in the deck are purely for entertainment and comical purposes. Any likeness to persons, organizations, or events are purely coincidental.</p>
        <a href={amazonUrl(tag)} target="_blank" rel="noopener">Get BUILD THAT WALL at Amazon.com</a>
        <nav class="menu__legal" aria-label="Legal">
          <a href="./how-to-play.html">About &amp; How to Play</a><span aria-hidden="true"> · </span><a href="./guide.html">Full Guide</a><span aria-hidden="true"> · </span><a href="./privacy.html">Privacy</a><span aria-hidden="true"> · </span><a href="./terms.html">Terms &amp; Conditions</a>
          {owner && <><span aria-hidden="true"> · </span><button type="button" class="menu__owner-link" onClick={() => setFixList(true)}>To-fix list</button></>}
        </nav>
        <small class="menu__tm">™ &amp; ® 2024 Beacon Political</small>
      </footer>
      {play && <PlayMenu onClose={() => setPlay(false)} />}
      {saved && <SavedGames onClose={() => setSaved(false)} />}
      {fixList && owner && <FixList onClose={() => setFixList(false)} />}
      {guide && <Guide onClose={() => setGuide(false)} finishLabel="Start a tutorial game" onFinish={startTutorialGame} />}
    </div>
  );
}
