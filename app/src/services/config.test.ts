import { describe, expect, it } from 'vitest';
import realSettings from '../../public/game-settings.json';   // the one the game serves (also copied to /classic/)
import { DEFAULT_SETTINGS, loadSettings, parseSettings } from './config';

describe('game settings', () => {
  it('reads the real game-settings.json: every name is known and every value is the right type', () => {
    const s = parseSettings(realSettings);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    for (const k of Object.keys(s) as (keyof typeof s)[]) expect(typeof s[k]).toBe(typeof DEFAULT_SETTINGS[k]);
  });

  it('maps names, skips notes and unknown keys, and keeps defaults for bad numbers', () => {
    const s = parseSettings({ _help: 'x', 'Server URL': 'https://s', 'Gold Price Month': '3.49', 'Free Online Players': 'lots', Extra: 1 });
    expect(s.serverUrl).toBe('https://s');
    expect(s.goldPriceMonth).toBe(3.49);
    expect(s.freeOnlinePlayers).toBe(4);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when the file is missing or the request fails', async () => {
    const missing = (async () => ({ ok: false })) as unknown as typeof fetch;
    expect((await loadSettings(missing)).status).toBe('none');
    const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await loadSettings(broken)).toEqual({ status: 'error', settings: DEFAULT_SETTINGS });
    const ok = (async () => ({ ok: true, json: async () => ({ Currency: 'EUR' }) })) as unknown as typeof fetch;
    expect((await loadSettings(ok)).settings.currency).toBe('EUR');
  });

  it('gives up on a slow host', async () => {
    const slow = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
    expect((await loadSettings(slow, 'x', 20)).status).toBe('error');
  });
});
