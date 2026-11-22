import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixes, loadFixes, setFix, sortFixes, type Fix } from './fixes';
import { services } from './services';

const fix = (id: number, asked: number, last: number, extra: Partial<Fix> = {}): Fix =>
  ({ id, list: 'public', text: 'Fix ' + id, type: 'bug', asked, first: 0, last, status: '', ...extra });

afterEach(() => { vi.restoreAllMocks(); fixes.set({ items: [], loading: false, error: '' }); });

describe('the To-fix list', () => {
  it('puts the most asked first, then the newest', () => {
    expect(sortFixes([fix(1, 1, 5), fix(2, 3, 1), fix(3, 1, 9)]).map(f => f.id)).toEqual([2, 3, 1]);
  });

  it("only loads for the owner: anyone else is told no and sees nothing", async () => {
    vi.spyOn(services, 'server').mockReturnValue('https://script.google.com/x');
    vi.spyOn(services.api, 'call').mockResolvedValue({ error: 'owner' });
    await loadFixes();
    expect(fixes.get()).toEqual({ items: [], loading: false, error: 'Only the owner can see this list.' });
  });

  it('ticks and trashes on the server, and puts it back if the server says no', async () => {
    vi.spyOn(services, 'server').mockReturnValue('https://script.google.com/x');
    const call = vi.spyOn(services.api, 'call').mockResolvedValueOnce({ items: [fix(1, 1, 1), fix(2, 1, 1, { list: 'private' })] });
    await loadFixes();
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
