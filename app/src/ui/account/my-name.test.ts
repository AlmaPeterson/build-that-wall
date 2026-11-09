// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '../services';
import { saveMyName } from './my-name';

const SERVER = 'https://script.google.com/macros/s/x/exec';
const token = 'h.' + btoa(JSON.stringify({ given_name: 'Ann', sub: '1', exp: Math.floor(Date.now() / 1000) + 3000 })).replace(/=+$/, '') + '.s';

describe('saving your name after the sign-in ran out', () => {
  const names: unknown[] = [];
  beforeEach(() => {
    names.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (url.includes('path=name')) names.push(body.name);
      return { json: async () => ({ ok: true }) };
    }));
    services.config.set({ ...services.config.get(), serverUrl: SERVER, googleClientId: 'id' });
    services.store.set('name', 'Old');
    services.store.set('user', JSON.stringify({ name: 'Ann', sub: '1', token: 'old', exp: 1000 }));
    services.refresh();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); services.store.set('user', ''); services.store.remove('name'); services.refresh(); });

  it('asks them to sign in again, then saves it to their account', async () => {
    vi.spyOn(services.google, 'signIn').mockImplementation(async () => services.google.acceptCredential(token));
    expect(await saveMyName('Sam')).toBe('ok');
    expect(names).toEqual(['Sam']);
    expect(services.store.get('name')).toBe('Sam');
    expect(services.player.get().expired).toBe(false);
  });

  it('says so and changes nothing if they cancel', async () => {
    vi.spyOn(services.google, 'signIn').mockResolvedValue('');
    expect(await saveMyName('Sam')).toBe('login');
    expect(names).toEqual([]);
    expect(services.store.get('name')).toBe('Old');
  });
});
