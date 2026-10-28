// @vitest-environment happy-dom
// The board driven by a real GameController with a fixed seed: the hand, the card popup's buttons,
// the Build Wall menu, building by picking 2 walls, and when input is disabled.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { settings } from '../app-state';

// These test the board and overlays, not the card animations (ui/anim has its own tests)
settings.update(s => ({ ...s, animSpeed: 'off' }));
import type { CardId } from '../../data/cards';
import { DEFAULT_SETTINGS } from '../../game';
import { GameController, type GameSnapshot } from '../controller';
import { Board } from './Board';
import { canInteract, dropAction, ranking, shownHand } from './board-state';

const tick = () => new Promise(r => setTimeout(r, 0));
let root: HTMLElement | null = null;

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
});

/** A 2-player game (you + a bot) that's waiting for you to act, with your hand set to `hand`. */
async function setup(hand: CardId[], actions = 3) {
  for (let seed = 1; seed < 200; seed++) {
    const c = new GameController();
    void c.start({ ...DEFAULT_SETTINGS, players: 2, bots: 1, difficulties: ['medium'] }, seed);
    await tick();
    const snap = c.snapshot.get();
    if (snap.view?.turn !== 0 || snap.prompt) continue;
    const s = c.api!.state;
    s.seats[0]!.hand = [...hand];
    s.actionsLeft = actions;
    c.refresh();
    root = document.createElement('div');
    document.body.appendChild(root);
    await act(() => { render(<Board controller={c} />, root!); });
    return c;
  }
  throw new Error('no seed starts on your turn');
}

const $ = (sel: string) => root!.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...root!.querySelectorAll<HTMLElement>(sel)];
const texts = (sel: string) => $$(sel).map(e => e.textContent?.trim());
const click = async (el: HTMLElement | null | undefined) => { await act(async () => { el!.click(); await tick(); }); };
const sideButton = (name: string) => $$('.side button').find(b => b.textContent === name) as HTMLButtonElement;

describe('Board', () => {
  it('shows one card per hand slot, with names', async () => {
    await setup([29, 14, 26]);
    expect($$('.hand__card img').map(i => i.getAttribute('alt'))).toEqual(['Wall Section 1', 'Man Hour', 'Trump']);
    expect($('.board__actions')?.textContent).toBe('3 actions left');
  });

  it('a Wall Section offers both ways to build when both are possible', async () => {
    await setup([29, 30, 31, 14]);
    await click($('.hand__card[data-slot="0"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Pick 2 Walls to Discard', 'Discard a Man Hour', 'Back']);
  });

  it("a Wall Section that can't be paid for explains why", async () => {
    await setup([29, 26]);
    await click($('.hand__card[data-slot="0"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Back']);
    expect($('.zoom__note')?.textContent).toMatch(/Man Hour or 2 other Wall Sections/);
  });

  it('a Man Hour offers Use On Wall, and building with it works', async () => {
    const c = await setup([14, 29]);
    await click($('.hand__card[data-slot="0"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Use On Wall', 'Back']);
    await click($$('.zoom__buttons button')[0]);
    expect($$('.hand__card--pickable').map(b => b.dataset.slot)).toEqual(['1']);
    await click($('.hand__card[data-slot="1"]'));
    expect(c.api!.state.seats[0]!.walls).toEqual([29]);
    expect(c.api!.state.actionsLeft).toBe(2);
  });

  it('with two Man Hours, the second one can build any wall too', async () => {
    const c = await setup([14, 29, 14, 30]);
    await click($('.hand__card[data-slot="2"]'));
    await click($$('.zoom__buttons button')[0]);
    expect($$('.hand__card--pickable').map(b => b.dataset.slot)).toEqual(['1', '3']);
    await click($('.hand__card[data-slot="3"]'));
    expect(c.api!.state.seats[0]!.walls).toEqual([30]);
    expect(c.api!.state.seats[0]!.hand).toEqual([14, 29]);
  });

  it('cards can be arranged by dragging (or Alt+arrows), and tapping still picks the right card', async () => {
    await setup([29, 14, 26]);
    const card = (name: string) => $$('.hand__card').find(b => b.querySelector('img')?.getAttribute('alt') === name)!;
    const names = () => $$('.hand__card img').map(i => i.getAttribute('alt'));
    // Drag Trump two places to the left
    const trump = card('Trump');
    await act(() => {
      trump.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, pointerId: 1, pointerType: 'mouse', bubbles: true }));
      trump.dispatchEvent(new PointerEvent('pointermove', { clientX: 180, pointerId: 1, pointerType: 'mouse', bubbles: true }));
      trump.dispatchEvent(new PointerEvent('pointerup', { clientX: 180, pointerId: 1, pointerType: 'mouse', bubbles: true }));
    });
    await click(card('Trump'));                     // the click after a drag isn't a tap
    expect($('.zoom')).toBeNull();
    expect(names()).toEqual(['Trump', 'Wall Section 1', 'Man Hour']);
    // Alt+→ moves the focused card one place right
    await act(() => { card('Trump').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })); });
    expect(names()).toEqual(['Wall Section 1', 'Trump', 'Man Hour']);
    // Tapping the Man Hour (now third) opens the Man Hour
    await click(card('Man Hour'));
    expect($('.zoom h3')?.textContent).toBe('Man Hour');
  });

  it('dropping a card: the discard pile plays it, your walls build it, anything else says why', async () => {
    const c = await setup([26, 29, 14, 30, 31, 20, 3]);
    const drop = (slot: number, zone: 'discard' | 'walls') => dropAction(c.api, c.snapshot.get(), slot, zone);
    expect(drop(0, 'discard')).toEqual({ choice: { kind: 'play', slot: 0 } });                 // Trump: play it
    expect(drop(1, 'walls')).toEqual({ open: true });                                          // Man Hour or 2 walls: ask
    expect(drop(2, 'walls')).toEqual({ choice: { kind: 'manHourOnWall', manHour: 2 } });       // Man Hour: pick the wall
    expect(drop(6, 'walls')).toEqual({ choice: { kind: 'play', slot: 6 } });                   // Assassin builds for free
    expect(drop(1, 'discard')).toEqual({ reason: 'Wall Sections are built: drop it on your walls.' });
    expect(drop(0, 'walls')).toMatchObject({ reason: expect.stringMatching(/discard pile to play it/) });
    expect(drop(5, 'discard')).toMatchObject({ reason: expect.stringMatching(/block an attack/) });  // Self-Defense
  });

  it('a wall with only one way to pay is built straight away', async () => {
    const c = await setup([29, 14]);
    expect(dropAction(c.api, c.snapshot.get(), 0, 'walls')).toEqual({ choice: { kind: 'build', slot: 0, manHour: 1 } });
  });

  it('playable cards show their cost; unplayable ones say why', async () => {
    await setup([26, 19, 20]);
    await click($('.hand__card[data-slot="0"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Play (1 action)', 'Back']);
    await click($$('.zoom__buttons button').at(-1));
    await click($('.hand__card[data-slot="1"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Back']);
    expect($('.zoom__note')?.textContent).toMatch(/Savings/);
  });

  it('with no actions left, a card that costs an action is not playable', async () => {
    await setup([26], 0);
    await click($('.hand__card[data-slot="0"]'));
    expect(texts('.zoom__buttons button')).toEqual(['Back']);
    expect($('.zoom__note')?.textContent).toBe('Not enough actions left.');
  });

  it('Build Wall lists every kind and payment, plus build cards', async () => {
    await setup([29, 30, 31, 14, 3]);
    await click(sideButton('Build Wall'));
    expect(texts('.board-modal__list button')).toEqual([
      'Wall Section 1 using your Man Hour', 'Wall Section 1 by discarding 2 other walls',
      'Wall Section 2 using your Man Hour', 'Wall Section 2 by discarding 2 other walls',
      'Wall Section 3 using your Man Hour', 'Wall Section 3 by discarding 2 other walls',
      'Play Assassin',
    ]);
  });

  it('building by picking 2 walls discards exactly those two', async () => {
    const c = await setup([29, 30, 31, 32]);
    await click($('.hand__card[data-slot="0"]'));
    await click($$('.zoom__buttons button').find(b => b.textContent === 'Pick 2 Walls to Discard'));
    expect($$('.hand__card--pickable').map(b => b.dataset.slot)).toEqual(['1', '2', '3']);
    await click($('.hand__card[data-slot="3"]'));
    expect($('.pickbar')?.textContent).toMatch(/Pick 1 more wall/);
    await click($('.hand__card[data-slot="1"]'));
    const s = c.api!.state;
    expect(s.seats[0]!.walls).toEqual([29]);
    expect(s.seats[0]!.hand).toEqual([31]);
    expect(s.discard.slice(-2).sort()).toEqual([30, 32]);
  });

  it("buttons are disabled and the hand hidden while it isn't your turn", async () => {
    const c = await setup([29, 14]);
    c.api!.state.turn = 1;   // the bot's turn
    await act(() => { c.refresh(); });
    expect(sideButton('End Turn').disabled).toBe(true);
    expect(sideButton('Build Wall').disabled).toBe(true);
    expect(sideButton('End Game').disabled).toBe(false);
    expect($('.hand__hidden')?.textContent).toMatch(/Hands are hidden/);
  });

  it('End Turn passes the turn to the bot and back', async () => {
    const c = await setup([29]);
    const before = c.api!.state.turnCount;
    await click(sideButton('End Turn'));
    await act(async () => { for (let i = 0; i < 5; i++) await tick(); });
    expect(c.api!.state.turnCount).toBeGreaterThan(before);
  });
});

describe('board-state', () => {
  const snap = (over: Partial<GameSnapshot>): GameSnapshot => ({
    view: { turn: 0, over: null, seats: [{ bot: null }, { bot: 'easy' }] } as unknown as GameSnapshot['view'],
    viewer: 0, events: [], prompt: null, passTo: null, ...over,
  });

  it('canInteract: only on your turn, with nothing waiting', () => {
    expect(canInteract(snap({}))).toBe(true);
    expect(canInteract(snap({}), true)).toBe(false);
    expect(canInteract(snap({ passTo: 0 }))).toBe(false);
    expect(canInteract(snap({ prompt: { decision: { kind: 'block', seat: 0, attacker: 1, card: 9 }, answer: () => {} } }))).toBe(false);
    expect(canInteract(snap({ viewer: 1 }))).toBe(false);
  });

  it('shownHand hides hands during a bot turn and in watch mode', () => {
    const v = snap({}).view!;
    expect(shownHand(snap({}))).toBe(0);
    expect(shownHand(snap({ view: { ...v, turn: 1 } }))).toBeNull();
    expect(shownHand(snap({ viewer: 1 }))).toBeNull();
    expect(shownHand(snap({ passTo: 0 }))).toBeNull();                    // the pass screen slides over the board
    expect(shownHand(snap({ view: { ...v, turn: -1 } }))).toBeNull();     // dealing
  });

  it("shownHand shows the playing bot's hand when only bots play", () => {
    const v = snap({}).view!;
    const bots = { ...v, seats: v.seats.map(s => ({ ...s, bot: s.bot ?? 'medium' as const })) };
    expect(shownHand(snap({ view: { ...bots, turn: 1 }, openHands: true }))).toBe(1);
    expect(shownHand(snap({ view: { ...bots, turn: 1 } }))).toBeNull();   // not an open-hands game
    expect(shownHand(snap({ view: { ...bots, turn: -1 }, openHands: true }))).toBeNull();
  });

  it('ranking shares a place on equal miles', () => {
    const state = { seats: [{ walls: [29] }, { walls: [29, 29] }, { walls: [30] }], trainGuards: [] } as unknown as Parameters<typeof ranking>[0];
    expect(ranking(state).map(r => [r.seat, r.miles, r.label])).toEqual([[1, 8, '1st:'], [0, 3, '2nd:'], [2, 3, '2nd:']]);
  });
});
