import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixes, fixPrompt, loadFixes, setFix, sortFixes, type Fix } from './fixes';
import { services } from './services';
import * as account from '../services/account';

const fix = (id: number, asked: number, last: number, extra: Partial<Fix> = {}): Fix =>
  ({ id, list: 'public', text: 'Fix ' + id, type: 'bug', asked, first: 0, last, status: '', ...extra });

afterEach(() => { vi.restoreAllMocks(); fixes.set({ items: [], loading: false, error: '', owner: false }); });

describe('the To-fix list', () => {
  it('copies a prompt that says what to fix and how', () => {
    const p = fixPrompt(fix(3, 2, 1, { text: 'The Settings button does nothing.', device: 'Chrome 140' }));
    expect(p).toContain('bug report (2 players asked for it)');
    expect(p).toContain('"The Settings button does nothing."');
    expect(p).toContain('Chrome 140');
    expect(p).toContain('Please find the cause and fix it.');
    expect(fixPrompt(fix(4, 1, 1, { type: 'feature', text: 'Add a dark mode.' }))).toMatch(/feature request:[\s\S]*Please add this to the game\./);
  });

  it('puts the most asked first, then the newest', () => {
    expect(sortFixes([fix(1, 1, 5), fix(2, 3, 1), fix(3, 1, 9)]).map(f => f.id)).toEqual([2, 3, 1]);
  });

  it('everyone else gets the public list, read only', async () => {
    vi.spyOn(services, 'server').mockReturnValue('https://script.google.com/x');
    vi.spyOn(account, 'isSignedIn').mockReturnValue(true);
    vi.spyOn(services.api, 'call').mockResolvedValue({ error: 'owner' });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ items: [fix(1, 2, 3)] })));
    await loadFixes(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('https://script.google.com/x?path=fixes');
    expect(fixes.get()).toMatchObject({ owner: false, error: '', items: [{ id: 1 }] });
  });

  it('says when the server is too old to have the list', async () => {
    vi.spyOn(services, 'server').mockReturnValue('https://script.google.com/x');
    vi.spyOn(account, 'isSignedIn').mockReturnValue(false);
    await loadFixes((async () => new Response('Build That Wall server is running.')) as unknown as typeof fetch);
    expect(fixes.get().error).toBe("The game server hasn't been updated for the To-fix list yet.");
  });

  it('ticks and trashes on the server, and puts it back if the server says no', async () => {
    vi.spyOn(services, 'server').mockReturnValue('https://script.google.com/x');
    vi.spyOn(account, 'isSignedIn').mockReturnValue(true);
    const call = vi.spyOn(services.api, 'call').mockResolvedValueOnce({ items: [fix(1, 1, 1), fix(2, 1, 1, { list: 'private' })] });
    await loadFixes();
    expect(fixes.get().owner).toBe(true);
    call.mockResolvedValueOnce({ ok: true });
    await setFix(fixes.get().items[0]!, 'done');
    expect(call).toHaveBeenLastCalledWith('https://script.google.com/x', '/admin/fix', { list: 'public', id: 1, status: 'done' });
    expect(fixes.get().items[0]!.status).toBe('done');
    call.mockResolvedValueOnce({ error: 'server' });
    await setFix(fixes.get().items[1]!, 'skip');
    expect(call).toHaveBeenLastCalledWith('https://script.google.com/x', '/admin/fix', { list: 'private', id: 2, status: 'skip' });
    expect(fixes.get().items[1]!.status).toBe('');
    expect(fixes.get().error).toMatch(/Couldn't save/);
  });
});
