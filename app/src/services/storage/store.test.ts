import { describe, expect, it } from 'vitest';
import { makeStore } from '../account/test-fakes';
import { SaveStore } from './store';

describe('SaveStore', () => {
  it('stores every key under btw:', () => {
    const { ls, store } = makeStore();
    store.set('name', 'Alex');
    expect(ls.getItem('btw:name')).toBe('Alex');
    expect(store.get('name')).toBe('Alex');
    expect(store.get('missing')).toBe('');
  });

  it('works without localStorage', () => {
    const store = new SaveStore(null);
    store.set('name', 'x');
    expect(store.get('name')).toBe('');
    expect(store.exportBackup()).toBeNull();
  });

  it('keeps prefs as one JSON object of strings', () => {
    const { ls, store } = makeStore();
    store.prefSet('sound', 1);
    store.prefSet('speed', 'fast');
    expect(store.prefGet('sound')).toBe('1');
    expect(store.prefGet('nope')).toBe('');
    expect(JSON.parse(ls.getItem('btw:prefs')!)).toEqual({ sound: '1', speed: 'fast' });
  });

  it('adds to stats', () => {
    const { store } = makeStore();
    store.statAdd('games', 1);
    store.statAdd('games', 2);
    expect(store.get('stat_games')).toBe('3');
  });

  it('stashes account data but not device data, and restores without overwriting', () => {
    const { ls, store } = makeStore();
    store.set('name', 'Alex');
    store.set('back', 'gold');
    store.set('lb', '{}');            // device key: stays out of the stash
    store.set('user', '{"sub":"1"}'); // device key
    store.stash('g:1');
    const stash = JSON.parse(ls.getItem('btw:acct:g:1')!);
    expect(stash).toEqual({ name: 'Alex', back: 'gold' });

    store.remove('name');
    store.set('back', 'red');         // newer value must win
    store.unstash('g:1');
    expect(store.get('name')).toBe('Alex');
    expect(store.get('back')).toBe('red');
  });

  it('restores an email account when the pop-up sign-in saves gemail', () => {
    const { ls, store } = makeStore();
    ls.setItem('btw:acct:e:alex@example.com', JSON.stringify({ color: 'blue' }));
    store.set('gemail', ' Alex@Example.com ');
    expect(store.get('color')).toBe('blue');
  });

  it('device keys match the old list', () => {
    for (const k of ['btw:user', 'btw:lb', 'btw:aimem', 'btw:trials', 'btw:fbsent', 'btw:fbraw', 'btw:gname', 'btw:gemail', 'btw:acct:g:1']) {
      expect(SaveStore.isDeviceKey(k)).toBe(true);
    }
    expect(SaveStore.isDeviceKey('btw:name')).toBe(false);
  });

  it('round-trips backups, leaving out the sign-in token', () => {
    const { store } = makeStore();
    store.set('name', 'Zoë 🧱');
    store.set('user', '{"token":"secret"}');
    const code = store.exportBackup()!;
    expect(code.startsWith('BTWSAVE1.')).toBe(true);

    const other = makeStore();
    expect(other.store.importBackup(code)).toBe('ok');
    expect(other.store.get('name')).toBe('Zoë 🧱');
    expect(other.store.get('user')).toBe('');
  });

  it('imports backups made by the old game', () => {
    // btoa(unescape(encodeURIComponent(JSON.stringify({"btw:name":"Zoë"}))))
    const old = 'BTWSAVE1.' + btoa(String.fromCharCode(...new TextEncoder().encode('{"btw:name":"Zoë"}')));
    const { store } = makeStore();
    expect(store.importBackup(old)).toBe('ok');
    expect(store.get('name')).toBe('Zoë');
    expect(store.importBackup('nonsense')).toBe('bad');
    expect(store.importBackup('BTWSAVE1.e30=')).toBe('bad');   // {} = nothing to import
  });

  it('clearLocal keeps the sign-in, leaderboard, trials and stashes', () => {
    const { ls, store } = makeStore();
    for (const k of ['user', 'lb', 'aimem', 'trials', 'name', 'codes', 'acct:g:1']) store.set(k, 'x');
    ls.setItem('other', 'not ours');
    store.clearLocal(false);
    expect(store.get('name')).toBe('');
    expect(store.get('codes')).toBe('');
    expect(store.get('user')).toBe('x');
    expect(store.get('acct:g:1')).toBe('x');
    expect(ls.getItem('other')).toBe('not ours');
    store.clearLocal(true);           // expired sign-in goes too
    expect(store.get('user')).toBe('');
  });
});
