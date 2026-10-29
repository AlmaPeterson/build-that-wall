// @vitest-environment happy-dom
// Double-click / right-click a card to see it full size, with Zoom In and Scan QR Code.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../app-state';
import { cardById } from '../../data/cards';
import { DEFAULT_SETTINGS } from '../../game';
import { showCard, zoomedCard } from '../components/zoom';
import { GameController } from '../controller';
import { Board } from './Board';
import { CardPopup, DOUBLE_CLICK_MS } from './CardPopup';
import { CardZoom } from './CardZoom';

settings.update(s => ({ ...s, animSpeed: 'off' }));
const tick = () => new Promise(r => setTimeout(r, 0));
let root: HTMLElement | null = null;
afterEach(() => { if (root) render(null, root); root?.remove(); root = null; zoomedCard.set(null); });

async function board(hand: number[]) {
  for (let seed = 1; seed < 200; seed++) {
    const c = new GameController();
    void c.start({ ...DEFAULT_SETTINGS, players: 2, bots: 1, difficulties: ['medium'], firstSeat: 0 }, seed);
    await tick();
    if (c.snapshot.get().view?.turn !== 0 || c.snapshot.get().prompt) continue;
    c.api!.state.seats[0]!.hand = [...hand];
    c.refresh();
    root = document.createElement('div');
    document.body.appendChild(root);
    await act(() => { render(<Board controller={c} />, root!); });
    return c;
  }
  throw new Error('no seed starts on your turn');
}

const fire = async (el: Element, type: string) => {
  await act(async () => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'contextmenu' ? 2 : 0 })); await tick(); });
};

describe('card zoom by double-click / right-click', () => {
  it('double-clicking a hand card shows it full size instead of its actions', async () => {
    await board([29, 14]);
    const card = root!.querySelectorAll('.hand__card')[1]!;
    await act(async () => { (card as HTMLElement).click(); await tick(); });   // the first click of the double-click
    expect(root!.querySelector('.zoom')).not.toBeNull();                        // its actions popup
    await fire(card, 'dblclick');
    expect(zoomedCard.get()).toBe(14);
    expect(root!.querySelector('.zoom')).toBeNull();                            // closed, so the full-size view is on top
  });

  it('right-clicking a hand card shows it full size, without the browser menu', async () => {
    await board([29, 14]);
    const card = root!.querySelector('.hand__card')!;
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    await act(async () => { card.dispatchEvent(e); await tick(); });
    expect(e.defaultPrevented).toBe(true);
    expect(zoomedCard.get()).toBe(29);
  });

  it('card backs never open', () => {
    showCard(4);
    expect(zoomedCard.get()).toBeNull();
  });

  it('the full-size view has Zoom In (picture as big as the window) and Scan QR Code (the card link)', async () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    showCard(29);
    await act(() => { render(<CardZoom />, root!); });
    const button = (t: string) => [...root!.querySelectorAll('button')].find(b => b.textContent === t);
    expect(button('Zoom In')).toBeTruthy();
    await act(async () => { button('Scan QR Code')!.click(); await tick(); });
    expect(open).toHaveBeenCalledWith(cardById(29).link, '_blank', 'noopener');
    await act(async () => { button('Zoom In')!.click(); await tick(); });
    expect(root!.querySelector('.card-zoom--big img')).not.toBeNull();
    await act(async () => { button('Zoom Out')!.click(); await tick(); });
    expect(root!.querySelector('.card-zoom--big')).toBeNull();
    expect(root!.querySelector('.zoom__card')).not.toBeNull();
    open.mockRestore();
  });

  it("a real double-click's second click lands on the actions popup: that opens the full-size view, a later click closes it", async () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    const dbl = vi.fn(), close = vi.fn();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    await act(() => { render(<CardPopup card={29} actions={{ buttons: [], note: '' }} onChoose={() => {}} onClose={close} onDoubleClick={dbl} />, root!); });
    now.mockReturnValue(1000 + DOUBLE_CLICK_MS - 50);
    await act(async () => { (root!.querySelector('.zoom') as HTMLElement).click(); await tick(); });
    expect(dbl).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    now.mockReturnValue(1000 + DOUBLE_CLICK_MS + 50);
    await act(async () => { (root!.querySelector('.zoom') as HTMLElement).click(); await tick(); });
    expect(dbl).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('right-clicking the big picture in an actions popup opens the full-size view', async () => {
    await board([29, 14]);
    await act(async () => { (root!.querySelector('.hand__card') as HTMLElement).click(); await tick(); });
    await fire(root!.querySelector('.zoom__card')!, 'contextmenu');
    expect(zoomedCard.get()).toBe(29);
  });
});
