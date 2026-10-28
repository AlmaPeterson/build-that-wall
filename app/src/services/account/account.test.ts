import { describe, expect, it } from 'vitest';
import { Entitlements } from '../gold/entitlements';
import { AccountService, OWNER_EMAIL_SHA256, sha256Hex } from './account';
import { ServerApi, isError } from './api';
import { GoogleSignIn, decodeIdToken, shortName } from './google';
import { SERVER, fakeApi, makeStore, signIn } from './test-fakes';
import { accountId, getUser, isSignedIn, maskedEmail, myName } from './user';

describe('ServerApi', () => {
  it('only talks to https servers', async () => {
    const { api, calls } = fakeApi({ '/load': {} });
    expect(await api.call('http://example.com', '/load', {})).toBeNull();
    expect(await api.call('', '/load', {})).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('posts plain text JSON with the id token, trimming trailing slashes', async () => {
    const { api, calls } = fakeApi({ '/save': { ok: true } });
    expect(await api.call(SERVER + '//', '/save', { data: { a: 1 } })).toEqual({ ok: true });
    expect(calls[0]!.url).toBe(SERVER + '?path=save');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    expect(calls[0]!.body).toEqual({ id_token: 'tok', data: { a: 1 } });
  });

  it('a null body is a plain GET', async () => {
    const { api, calls } = fakeApi({ '/leaderboard': { players: [] } });
    await api.call(SERVER, '/leaderboard', null);
    expect(calls[0]!.init).toEqual({});
  });

  it('returns null when offline or the reply is not JSON', async () => {
    expect(await fakeApi({}).api.call(SERVER, '/load', {})).toBeNull();
    const badJson = new ServerApi(async () => ({ json: async () => { throw new SyntaxError('x'); } }), () => '');
    expect(await badJson.call(SERVER, '/load', {})).toBeNull();
  });

  it('passes server errors through', async () => {
    const r = await fakeApi({ '/load': { error: 'login' } }).api.call(SERVER, '/load', {});
    expect(isError(r) && r.error).toBe('login');
  });
});

describe('user helpers', () => {
  it('account ids, names and masked emails', () => {
    const { store } = makeStore();
    expect(accountId(store)).toBe('');
    expect(myName(store)).toBe('Player');
    expect(isSignedIn(store)).toBe(false);
    store.set('gemail', 'Sam@Example.com');
    expect(accountId(store)).toBe('e:sam@example.com');
    expect(maskedEmail(store)).toBe('Sam...@Example.com');
    signIn(store);
    expect(accountId(store)).toBe('g:123');
    expect(myName(store)).toBe('Alex');
    store.set('name', 'Builder');
    expect(myName(store)).toBe('Builder');
  });
});

describe('AccountService', () => {
  function setup(replies: Record<string, unknown> = {}, signedIn = true) {
    const { store } = makeStore();
    if (signedIn) signIn(store);
    const ent = new Entitlements(store);
    const { api, calls } = fakeApi(replies);
    return { store, ent, calls, acct: new AccountService(store, ent, api) };
  }

  it('load applies the server entitlements and saved data', async () => {
    const { store, ent, acct } = setup({ '/load': { packs: ['p'], data: { name: 'Sam' } } });
    expect(await acct.load(SERVER)).toBe('ok');
    expect(ent.ownsPack('p')).toBe(true);
    expect(store.get('name')).toBe('Sam');
  });

  it('load results when signed out, offline or the token expired', async () => {
    expect(await setup({}, false).acct.load(SERVER)).toBe('local');
    expect(await setup({}).acct.load(SERVER)).toBe('noserver');
    expect(await setup({ '/load': { error: 'login' } }).acct.load(SERVER)).toBe('login');
  });

  it('save sends only the account keys', async () => {
    const { store, acct, calls } = setup({ '/save': { ok: true } });
    store.set('name', 'Sam'); store.set('codes', '["secret"]');
    acct.save(SERVER);
    await Promise.resolve();
    const data = calls[0]!.body!.data as Record<string, string>;
    expect(data.name).toBe('Sam');
    expect(Object.keys(data)).toEqual(['name', 'back', 'color', 'starc', 'namebg', 'tutor', 'prefs', 'lb',
      'stat_games', 'stat_wins', 'stat_best', 'stat_walls']);
  });

  it('delete removes the server account, the stash and the sign-in', async () => {
    const { store, acct } = setup({ '/delete': { ok: true } });
    store.set('acct:g:123', '{}'); store.set('name', 'Sam'); store.set('lb', '{}');
    expect(await acct.delete(SERVER)).toBe('ok');
    expect(store.get('acct:g:123')).toBe('');
    expect(store.get('name')).toBe('');
    expect(getUser(store)).toBeNull();
    expect(store.get('lb')).toBe('{}');
  });

  it('claimName: taken, ok, or local only', async () => {
    expect(await setup({ '/name': { error: 'taken' } }).acct.claimName(SERVER, 'Sam')).toBe('taken');
    expect(await setup({ '/name': { ok: true } }).acct.claimName(SERVER, 'Sam')).toBe('ok');
    expect(await setup({}).acct.claimName('', 'Sam')).toBe('local');
  });

  it('postScore sends the game result', async () => {
    const { acct, calls } = setup({ '/score': { ok: true } });
    acct.postScore(SERVER, { miles: 12, won: true, walls: 3, name: 'A very long name that is too long' });
    await Promise.resolve();
    expect(calls[0]!.body).toMatchObject({ miles: 12, won: true, walls: 3, name: 'A very long name tha' });
  });

  it('owner check uses the email hash', async () => {
    const { acct } = setup();
    expect(await acct.ownerCheck()).toBe(false);
    expect(await sha256Hex(' X@Y.com ')).toBe(await sha256Hex('x@y.com'));
    expect(OWNER_EMAIL_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('admin search and delete on this device', async () => {
    const { store, acct } = setup({}, false);
    store.setJson('lb', { Alex: { games: 3 }, Sam: { games: 1 } });
    expect(await acct.adminSearch('', 'al')).toEqual([{ id: 'local:Alex', name: 'Alex', games: 3 }]);
    expect(await acct.adminDelete('', 'local:Alex')).toBe('ok');
    expect(Object.keys(store.getJson('lb', {}))).toEqual(['Sam']);
  });

  it('admin search through the server', async () => {
    const { acct } = setup({ '/admin/search': { users: [{ id: 'g1', name: 'Zed', games: 9 }] }, '/admin/delete': { error: 'owner' } });
    expect(await acct.adminSearch(SERVER, 'z')).toEqual([{ id: 'g1', name: 'Zed', games: 9 }]);
    expect(await acct.adminDelete(SERVER, 'g1')).toBe('owner');
  });
});

describe('GoogleSignIn', () => {
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('saves the player from the ID token and restores their stash', () => {
    const { store } = makeStore();
    store.set('acct:g:42', JSON.stringify({ color: 'green' }));
    const cred = 'h.' + b64url({ given_name: 'Jo', email: 'jo@x.com', sub: '42', exp: 99 }) + '.s';
    const g = new GoogleSignIn(store, async () => { throw new Error('no DOM'); });
    expect(g.acceptCredential(cred)).toBe('Jo');
    expect(getUser(store)).toEqual({ name: 'Jo', email: 'jo@x.com', sub: '42', token: cred, exp: 99 });
    expect(store.get('color')).toBe('green');
    expect(decodeIdToken(cred).sub).toBe('42');
  });

  it('signing out signs out of both kinds of sign-in, and keeps the saves for next time', () => {
    const { store } = makeStore();
    signIn(store, { sub: '42' });
    store.set('gname', 'Alex');
    store.set('gemail', 'alex@example.com');
    store.set('color', 'green');
    expect(isSignedIn(store)).toBe(true);
    new GoogleSignIn(store, async () => { throw new Error('no DOM'); }).signOut();
    expect(isSignedIn(store)).toBe(false);
    expect(store.get('gname')).toBeFalsy();
    expect(store.get('gemail')).toBeFalsy();
    expect(JSON.parse(store.get('acct:g:42') || '{}')).toMatchObject({ color: 'green' });
  });

  it('names are at most 20 characters, emoji counted once', () => {
    expect(shortName('')).toBe('Player');
    expect(shortName('🧱'.repeat(25))).toBe('🧱'.repeat(20));
  });

  it('no client id means no sign-in', async () => {
    const { store } = makeStore();
    expect(await new GoogleSignIn(store).signIn('')).toBe('nosetup');
  });
});
