// @vitest-environment happy-dom
// The board driven by a real GameController with a fixed seed: the hand, the card popup's buttons,
// building by picking 2 walls, and when input is disabled.
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

  it('the hand is sorted by colour with copies stacked, and tapping still picks the right card', async () => {
    await setup([7, 26, 14, 29, 14, 20, 30]);
    const names = () => $$('.hand__card img').map(i => i.getAttribute('alt'));
    // Walls, Man Hours, Trump, Debt, Self Defense; both Man Hours together
    expect(names()).toEqual(['Wall Section 1', 'Wall Section 2', 'Man Hour', 'Man Hour', 'Trump', 'Debt', 'Self Defense']);
    const [low, high] = $$('.hand__card[data-card="14"]');
    // The second Man Hour sits on the first, a little lower, in the same column
    const units = (v: string) => parseFloat(v.split('*')[1]!);
    expect(low!.style.left).toBe(high!.style.left);
    expect(units(high!.style.top)).toBeGreaterThan(units(low!.style.top));
    expect(Number(high!.style.zIndex)).toBeGreaterThan(Number(low!.style.zIndex));
    // Tapping the Debt (slot 0, shown sixth) opens the Debt
    await click($('.hand__card[data-slot="0"]'));
    expect($('.zoom h3')?.textContent).toBe('Debt');
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

  it("while it isn't your turn: buttons are disabled, your hand still shows but can't be played", async () => {
    const c = await setup([29, 14]);
    c.api!.state.turn = 1;   // the bot's turn
    await act(() => { c.refresh(); });
    expect(sideButton('End Turn').disabled).toBe(true);
    expect(sideButton('End Game').disabled).toBe(false);
    expect($('.hand__hidden')).toBeNull();
    expect(root!.querySelectorAll('.hand button[data-slot]').length).toBe(2);
    await click(root!.querySelector<HTMLButtonElement>('.hand button[data-slot="0"]')!);
    expect(root!.textContent).toContain('You can use this card on your turn.');     // look, but no actions
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

  it('End Turn is on its own at the top; End Game is last at the bottom and looks different', async () => {
    await setup([29]);
    expect(texts('.side--top button')).toEqual(['End Turn']);
    expect(texts('.side--bottom button')).toEqual(['Settings', 'Tutorial', 'Instructions', 'End Game']);
    expect(sideButton('End Game').classList.contains('side__end-game')).toBe(true);
    expect(sideButton('Settings').classList.contains('side__end-game')).toBe(false);
  });

  it('End Turn turns green once there are no actions left', async () => {
    await setup([29], 1);
    expect(sideButton('End Turn').classList.contains('btw-ready')).toBe(false);
    render(null, root!);
    await setup([29], 0);
    expect(sideButton('End Turn').classList.contains('btw-ready')).toBe(true);
  });

  it('the turn banner keeps the board locked until OK', () => {
    expect(canInteract(snap({ turnBanner: 0 }))).toBe(false);
  });

  it('canInteract: only on your turn, with nothing waiting', () => {
    expect(canInteract(snap({}))).toBe(true);
    expect(canInteract(snap({}), true)).toBe(false);
    expect(canInteract(snap({ passTo: 0 }))).toBe(false);
    expect(canInteract(snap({ prompt: { decision: { kind: 'block', seat: 0, attacker: 1, card: 9 }, answer: () => {} } }))).toBe(false);
    expect(canInteract(snap({ viewer: 1 }))).toBe(false);
  });

  it('shownHand: one person sees their own hand on every turn; Pass\'n\'Play hides it during bot turns', () => {
    const v = snap({}).view!;
    expect(shownHand(snap({}))).toBe(0);
    expect(shownHand(snap({ view: { ...v, turn: 1 } }))).toBe(0);                       // a bot's turn: still your hand
    expect(shownHand(snap({ view: { ...v, turn: 1 }, turnBanner: 0 }))).toBe(0);
    expect(shownHand(snap({ view: { ...v, turn: 1 }, sharedDevice: true }))).toBeNull(); // the device may be changing hands
    expect(shownHand(snap({ turnBanner: 0, sharedDevice: true }))).toBeNull();
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
