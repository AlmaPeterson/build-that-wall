// The Music part of Settings: on or off, how loud, and what plays (the game's own song, or the player's
// YouTube links, song links and songs from their computer). The music itself is in audio.ts.
import { useState } from 'preact/hooks';
import type { UiSettings } from '../app-state';
import { music, nowPlaying, parseMusicLink, type Track } from '../audio';
import { Button } from '../components/Button';
import { Choice, Row, Toggle } from '../menus/controls';
import { updateSettings } from '../menus/prefs';
import { addMySongs, mySongs, pickSongFiles, removeMySong } from '../music/my-songs';
import { useStore } from '../store';

const set = (patch: Partial<UiSettings>) => updateSettings(s => ({ ...s, ...patch }));

const BAD_LINK = "That link can't be played here. Use a YouTube video or playlist, or a link to a song file (.mp3, .m4a, .ogg or .wav).";

/** What kind of link it is, for the list. */
export function linkKind(t: Track | null): string {
  switch (t?.type) {
    case 'yt': return 'YouTube video';
    case 'ytlist': return 'YouTube playlist';
    case 'url': return 'Song link';
    default: return "Can't be played";
  }
}

function playingName(t: Track | null, songs: { id: string; name: string }[]): string {
  if (!t) return '';
  if (t.type === 'default') return "the game's song";
  if (t.type === 'file') return songs.find(x => x.id === t.id)?.name ?? 'your song';
  return 'a ' + linkKind(t).toLowerCase();
}

export function MusicSettings({ s }: { s: UiSettings }) {
  const songs = useStore(mySongs);
  useStore(nowPlaying);
  const [link, setLink] = useState('');
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const mine = s.musicSource === 'mine';

  const addLink = () => {
    const text = link.trim();
    if (!text) return;
    if (!parseMusicLink(text)) { setSaid({ text: BAD_LINK, ok: false }); return; }
    if (s.musicLinks.includes(text)) { setSaid({ text: 'That link is already on your list.', ok: false }); return; }
    set({ musicLinks: [...s.musicLinks, text] });
    setLink(''); setSaid({ text: 'Link added.', ok: true });
  };
  const addFiles = async () => {
    const files = await pickSongFiles();
    if (!files.length) return;
    const n = await addMySongs(files);
    setSaid(n ? { text: n === 1 ? 'Song added.' : `${n} songs added.`, ok: true }
      : { text: "Those files aren't songs, or there's no more room for songs in this browser.", ok: false });
  };

  const current = music.current();
  return (
    <>
      <h2 class="settings__section">Music</h2>
      <Row label="Music"><Toggle label="Music" on={s.music} onChange={on => set({ music: on })} /></Row>
      <div class="settings__text">
        <div class="settings__label">Music volume</div>
        <div class="settings__slider">
          <span aria-hidden="true">🔈</span>
          <input type="range" aria-label="Music volume" min={0} max={100} step={5} value={s.musicVolume} disabled={!s.music}
            aria-valuetext={s.musicVolume + '%'} onInput={e => set({ musicVolume: Number(e.currentTarget.value) })} />
          <span aria-hidden="true">🔊</span>
          <output>{s.musicVolume}%</output>
        </div>
      </div>
      <div class="settings__text">
        <div class="settings__label">What plays</div>
        <Choice label="What plays" value={s.musicSource} onChange={musicSource => set({ musicSource })}
          options={[{ value: 'default', name: "The game's song" }, { value: 'mine', name: 'My music' }]} />
      </div>

      {mine && (
        <div class="settings__text music">
          <Row label="Music Mode" id="set-music">
            <select id="set-music" value={s.musicMode} onChange={e => set({ musicMode: e.currentTarget.value === 'one' ? 'one' : 'cycle' })}>
              <option value="cycle">Cycle All</option>
              <option value="one">Play One</option>
            </select>
          </Row>
          <div class="settings__about">Cycle All plays your songs one after another. Play One plays the same song again and again.</div>
          <form class="music__add" onSubmit={e => { e.preventDefault(); addLink(); }}>
            <input type="url" inputMode="url" value={link} placeholder="Paste a YouTube or song link" aria-label="Music link"
              onInput={e => setLink(e.currentTarget.value)} />
            <Button color="plain" type="submit">Add link</Button>
          </form>
          <Button color="plain" onClick={addFiles}>Add songs from your computer</Button>
          {said && <p class={'music__said' + (said.ok ? '' : ' is-bad')} role="status">{said.text}</p>}
          {s.musicLinks.length + songs.length === 0
            ? <p class="settings__about">Add a link or a song. Until then, the game's song plays.</p>
            : (
              <ul class="music__list" aria-label="Your music">
                {s.musicLinks.map(l => (
                  <li key={'l' + l}>
                    <span class="music__name"><b>{linkKind(parseMusicLink(l))}</b> {l}</span>
                    <Button color="plain" aria-label={'Remove ' + l} onClick={() => set({ musicLinks: s.musicLinks.filter(x => x !== l) })}>Remove</Button>
                  </li>
                ))}
                {songs.map(x => (
                  <li key={'f' + x.id}>
                    <span class="music__name"><b>Song</b> {x.name}</span>
                    <Button color="plain" aria-label={'Remove ' + x.name} onClick={() => void removeMySong(x.id)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
          <p class="settings__about">Songs from your computer stay in this browser only.</p>
        </div>
      )}

      {s.music && (
        <div class="music__now" aria-live="polite">
          {current
            ? <span>Now playing {playingName(current, songs)}{music.count() > 1 ? ` (${music.number()} of ${music.count()})` : ''}</span>
            : <span>The music starts when you tap or press a key.</span>}
          {music.count() > 1 && current && <Button color="plain" onClick={() => { music.next(); nowPlaying.set(nowPlaying.get() + 1); }}>Next song</Button>}
        </div>
      )}
    </>
  );
}
