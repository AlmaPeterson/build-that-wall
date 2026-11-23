// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage, SaveStore } from '../../services/storage';
import { DEFAULT_UI_SETTINGS, settings } from '../app-state';
import { parseMusicLink, tracksFor } from '../audio';
import { loadUiSettings, resetSettingsPersistenceForTests, saveUiSettings } from '../menus/prefs';
import { SettingsScreen } from '../screens/Settings';
import { SONGS, SONG_STEPS, bassNotes, leadNotes } from './default-song';
import { addMySongs, mySongs, removeMySong } from './my-songs';

describe('music links', () => {
  it('plays YouTube videos and playlists, and links to song files', () => {
    expect(parseMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ type: 'yt', id: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://youtu.be/dQw4w9WgXcQ')).toEqual({ type: 'yt', id: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'))
      .toEqual({ type: 'ytlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' });
    expect(parseMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'))
      .toEqual({ type: 'ytlist', list: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', id: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://example.com/songs/march.mp3')).toEqual({ type: 'url', url: 'https://example.com/songs/march.mp3' });
  });

  it("turns down links it can't play", () => {
    expect(parseMusicLink('not a link')).toBeNull();
    expect(parseMusicLink('https://example.com/page.html')).toBeNull();
    expect(parseMusicLink('javascript:alert(1)//.mp3')).toBeNull();
    expect(parseMusicLink('https://www.youtube.com/')).toBeNull();
  });
});

describe('what plays', () => {
  const song = { id: 's1', name: 'March', blob: new Blob(['x']) };

  it("plays the game's song unless the player picked their own music", () => {
    expect(tracksFor({ musicSource: 'default', musicLinks: ['https://youtu.be/dQw4w9WgXcQ'] }, [song])).toEqual([{ type: 'default' }]);
    expect(tracksFor({ musicSource: 'mine', musicLinks: ['https://youtu.be/dQw4w9WgXcQ', 'bad'] }, [song]))
      .toEqual([{ type: 'yt', id: 'dQw4w9WgXcQ' }, { type: 'file', id: 's1', blob: song.blob }]);
  });

  it("plays the song picked from the game's songs, or all of them one after another", () => {
    expect(tracksFor({ musicSource: 'default', musicLinks: [], musicSong: 'rag' }, [])).toEqual([{ type: 'default', song: 'rag' }]);
    expect(tracksFor({ musicSource: 'default', musicLinks: [], musicSong: 'march' }, [])).toEqual([{ type: 'default' }]);
    expect(tracksFor({ musicSource: 'default', musicLinks: [], musicSong: 'all' }, [])).toEqual(SONGS.map(x => ({ type: 'default', song: x.id })));
  });

  it("falls back to the game's song when the player has no music yet", () => {
    expect(tracksFor({ musicSource: 'mine', musicLinks: [] }, [])).toEqual([{ type: 'default' }]);
  });
});

describe("the game's song", () => {
  it('fills its bars and stays in range', () => {
    const lead = leadNotes(), bass = bassNotes();
    expect(lead.length).toBeGreaterThan(60);
    expect(Math.max(...lead.map(n => n.step + n.length))).toBeLessThanOrEqual(SONG_STEPS);
    expect(Math.max(...bass.map(n => n.step + n.length))).toBe(SONG_STEPS);
    expect(lead.every(n => n.midi >= 60 && n.midi <= 79)).toBe(true);
  });

  it('every song that comes with the game has 8 steps in every bar, one chord a bar, and notes in range', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(SONGS.map(x => x.id)).size).toBe(SONGS.length);
    for (const song of SONGS) {
      const bars = song.lead.split('|').flatMap(line => line.split(/\r?\n/)).map(b => b.trim()).filter(Boolean);
      expect(bars.every(b => b.split(/\s+/).length === 8), song.name).toBe(true);
      expect(bars.length, song.name).toBe(song.chords.length);
      const lead = leadNotes(song.lead);
      expect(lead.length, song.name).toBe(song.lead.split(/\s+/).filter(t => /^[A-G]#?\d$/.test(t)).length);
      expect(lead.every(n => n.midi >= 60 && n.midi <= 84), song.name).toBe(true);
      expect(bassNotes(song.chords).every(n => n.midi >= 36 && n.midi <= 59), song.name).toBe(true);
    }
    expect(bassNotes(['A#'])[0]!.midi).toBe(46);
  });

  it('reads holds and rests', () => {
    expect(leadNotes('C4 - - . E4 | G4')).toEqual([{ step: 0, length: 3, midi: 60 }, { step: 4, length: 1, midi: 64 }, { step: 5, length: 1, midi: 67 }]);
  });
});

describe('music settings', () => {
  it('are saved and come back', () => {
    const store = new SaveStore(new MemoryStorage());
    saveUiSettings(store, { ...DEFAULT_UI_SETTINGS, music: false, musicVolume: 30, musicSource: 'mine', musicLinks: ['https://youtu.be/dQw4w9WgXcQ'] });
    const back = loadUiSettings(store, DEFAULT_UI_SETTINGS);
    expect(back).toMatchObject({ music: false, musicVolume: 30, musicSource: 'mine', musicLinks: ['https://youtu.be/dQw4w9WgXcQ'] });
  });

  it("start on, with the game's song", () => {
    expect(loadUiSettings(new SaveStore(new MemoryStorage()), DEFAULT_UI_SETTINGS))
      .toMatchObject({ music: true, musicSource: 'default', musicLinks: [] });
  });
});

describe('the Music part of Settings', () => {
  let root: HTMLElement;
  beforeEach(() => {
    resetSettingsPersistenceForTests();
    localStorage.clear();
    settings.set(DEFAULT_UI_SETTINGS);
    root = document.createElement('div'); document.body.appendChild(root);
  });
  afterEach(() => { render(null, root); root.remove(); mySongs.set([]); });

  const button = (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement;

  it('turns music off and changes the volume', () => {
    act(() => { render(<SettingsScreen />, root); });
    act(() => { (root.querySelector('[aria-label="Music"]') as HTMLButtonElement).click(); });
    expect(settings.get().music).toBe(false);
    act(() => { (root.querySelector('[aria-label="Music"]') as HTMLButtonElement).click(); });
    const vol = root.querySelector('input[aria-label="Music volume"]') as HTMLInputElement;
    act(() => { vol.value = '80'; vol.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(settings.get().musicVolume).toBe(80);
  });

  it('adds and removes links, and turns down ones that can\'t play', () => {
    act(() => { render(<SettingsScreen />, root); });
    expect(root.querySelector('input[aria-label="Music link"]')).toBeNull();
    act(() => { button('My music').click(); });
    const input = root.querySelector('input[aria-label="Music link"]') as HTMLInputElement;
    const submit = (v: string) => {
      act(() => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); });
      act(() => { root.querySelector('form.music__add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    };
    submit('https://example.com/page');
    expect(root.querySelector('.music__said')!.textContent).toContain("can't be played");
    submit('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    expect(settings.get().musicLinks).toEqual(['https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG']);
    expect(root.querySelector('.music__list')!.textContent).toContain('YouTube playlist');
    act(() => { button('Remove').click(); });
    expect(settings.get().musicLinks).toEqual([]);
  });

  it('lists songs from the computer', async () => {
    settings.set({ ...DEFAULT_UI_SETTINGS, musicSource: 'mine' });
    act(() => { render(<SettingsScreen />, root); });
    const added = await addMySongs([new File(['x'], 'Anthem.mp3', { type: 'audio/mpeg' }), new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(added).toBe(1);
    act(() => {});
    expect(root.querySelector('.music__list')!.textContent).toContain('Anthem');
    await removeMySong(mySongs.get()[0]!.id);
    act(() => {});
    expect(root.querySelector('.music__list')).toBeNull();
  });
});
