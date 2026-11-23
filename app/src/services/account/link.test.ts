import { describe, expect, it } from 'vitest';
import { linkCode, linkIdIn, linkUrl, newLinkId, onItch, signInElsewhere } from './link';

const ID = 'abcdefghijklmnopqrstuvwxyz012345';

describe('Google sign-in for itch.io', () => {
  it('knows when the game is on itch.io', () => {
    expect(onItch('html-classic.itch.zone')).toBe(true);
    expect(onItch('beacon-political.itch.io')).toBe(true);
    expect(onItch('almapeterson.github.io')).toBe(false);
    expect(onItch('notitch.zone.example.com')).toBe(false);
  });

  it('makes long random ids, a 4-letter code both pages agree on, and a website link', () => {
    const id = newLinkId();
    expect(id).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(newLinkId()).not.toBe(id);
    expect(linkCode(ID)).toMatch(/^[A-Z2-9]{4}$/);
    expect(linkCode(ID)).toBe(linkCode(ID));
    expect(linkUrl(ID)).toBe('https://almapeterson.github.io/build-that-wall/?link=' + ID);
    expect(linkIdIn('?link=' + ID)).toBe(ID);
    expect(linkIdIn('?link=short')).toBeNull();
    expect(linkIdIn('?link=<script>alert(1)</script>xxxxxxxxxxxx')).toBeNull();
  });

  it('opens the website, waits for the Yes, then signs in with what the server hands over', async () => {
    const calls: unknown[] = [];
    const replies = [{ waiting: true }, null, { token: 'BTWS.x.y', id: '123', name: 'Alma', exp: 9 }];
    let opened = '', shown = '', accepted = '';
    const r = await signInElsewhere({
      id: ID, wait: async () => {}, stillOpen: () => true,
      open: u => { opened = u; }, show: (code, url) => { shown = code + ' ' + url; },
      call: async (path, body) => { calls.push([path, body]); return replies.shift() ?? null; },
      accept: a => { accepted = a.token; return a.name; },
    });
    expect(r).toEqual({ name: 'Alma' });
    expect(opened).toBe(linkUrl(ID));
    expect(shown).toBe(linkCode(ID) + ' ' + linkUrl(ID));
    expect(calls).toEqual([['auth/link-claim', { link: ID }], ['auth/link-claim', { link: ID }], ['auth/link-claim', { link: ID }]]);
    expect(accepted).toBe('BTWS.x.y');
  });

  it('stops when the box is closed', async () => {
    let open = true, n = 0;
    const r = await signInElsewhere({
      id: ID, wait: async () => { if (++n === 2) open = false; }, stillOpen: () => open, open: () => {}, show: () => {},
      call: async () => ({ waiting: true }), accept: () => 'x',
    });
    expect(r).toEqual({ error: 'cancelled' });
  });
});
