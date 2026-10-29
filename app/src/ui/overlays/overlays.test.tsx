// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../app-state';

// These test the board and overlays, not the card animations (ui/anim has its own tests)
settings.update(s => ({ ...s, animSpeed: 'off' }));
import { createGame, type Decision, type GameEvent, type GameState } from '../../game';
import { GameController, type Prompt } from '../controller';
import { Overlays } from './Overlays';
import { PICK_SECONDS, PromptView } from './Prompt';
import { PASS_GUARD_MS, PassScreen, Recap, WinScreen } from './Screens';
import { optionLabel, passWhy, personal, recapFor, wallToastFor } from './text';

let root: HTMLElement;
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
afterEach(() => { render(null, root); root.remove(); vi.useRealTimers(); });

function view(): GameState {
  const s = createGame({ players: 3, bots: 0, difficulties: [], names: ['Ann', 'Ben', 'Cat'], ending: 1, endingTimes: 1,
    actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 1);
  s.seats[0]!.hand = [29, 14, 7, 30];
  s.seats[1]!.hand = [20];
  s.seats[1]!.walls = [31, 31, 32];
  s.turn = 0;
  return s;
}

/** Render a prompt and return what it was answered with. */
function ask<D extends Decision>(decision: D) {
  const answers: unknown[] = [];
  const prompt = { decision, answer: (v: unknown) => answers.push(v) } as unknown as Prompt;
  act(() => render(<PromptView prompt={prompt} view={view()} />, root));
  return answers;
}

const buttons = () => [...root.querySelectorAll('button')];
const click = (label: string | RegExp) => {
  const b = buttons().find(x => (typeof label === 'string' ? x.textContent?.includes(label) || x.getAttribute('aria-label')?.includes(label) : label.test(x.textContent ?? '')));
  if (!b) throw new Error('No button ' + label + ' in: ' + buttons().map(x => x.textContent).join(' | '));
  act(() => b.click());
};
const press = (key: string) => act(() => { dispatchEvent(new KeyboardEvent('keydown', { key })); });

describe('prompts', () => {
  it('block: yes and no', () => {
    const a = ask({ kind: 'block', seat: 1, attacker: 0, card: 6 });
    expect(root.textContent).toContain('Ann played Controlled Opposition on you.');
    click('Block it');
    expect(a).toEqual([true]);
    const b = ask({ kind: 'block', seat: 1, attacker: 0, card: 6 });
    click("Don't block");
    expect(b).toEqual([false]);
  });

  it('block has no Escape (it must be answered)', () => {
    const a = ask({ kind: 'block', seat: 1, attacker: 0, card: 6 });
    press('Escape');
    expect(a).toEqual([]);
  });

  it('paySavings', () => {
    const a = ask({ kind: 'paySavings', seat: 1, attacker: 0 });
    click('Pay with Savings');
    expect(a).toEqual([true]);
  });

  it('chooseSeat: pick, and cancel only when cancellable', () => {
    const a = ask({ kind: 'chooseSeat', seat: 0, card: 9, options: [1, 2], cancellable: true });
    click('Cat');
    expect(a).toEqual([2]);
    const b = ask({ kind: 'chooseSeat', seat: 0, card: 9, options: [1, 2], cancellable: true });
    press('Escape');
    expect(b).toEqual([null]);
    ask({ kind: 'chooseSeat', seat: 0, card: 9, options: [1, 2], cancellable: false });
    expect(buttons().some(x => x.textContent === 'Cancel')).toBe(false);
  });

  it('chooseWall shows the owner and how many they built', () => {
    const a = ask({ kind: 'chooseWall', seat: 0, card: 7, options: [{ seat: 1, kind: 31 }, { seat: 1, kind: 32 }], cancellable: true });
    expect(root.textContent).toContain('Ben');
    expect(root.textContent).toContain('×2');
    click('Wall Section 3');
    expect(a).toEqual([{ seat: 1, kind: 31 }]);
    const b = ask({ kind: 'chooseWall', seat: 0, card: 7, options: [{ seat: 1, kind: 31 }], cancellable: true });
    click('Cancel');
    expect(b).toEqual([null]);
  });

  it('chooseHandCard: give names the receiver; optional builds can stop', () => {
    const a = ask({ kind: 'chooseHandCard', seat: 0, card: 8, purpose: 'give', options: [0, 2], to: 1, optional: false });
    expect(root.textContent).toContain('It goes to Ben.');
    expect(buttons().some(x => x.textContent === 'Skip')).toBe(false);
    click('Debt');
    expect(a).toEqual([2]);
    const b = ask({ kind: 'chooseHandCard', seat: 0, card: 3, purpose: 'build', options: [0, 3], optional: true });
    click('Stop building');
    expect(b).toEqual([null]);
  });

  it('chooseOption with friendly labels and cancel', () => {
    expect(optionLabel('protect')).toBe('Protect a pair of walls');
    const a = ask({ kind: 'chooseOption', seat: 0, card: 25, options: ['draw', 'protect'], cancellable: true });
    click('Draw 3 cards');
    expect(a).toEqual(['draw']);
    const b = ask({ kind: 'chooseOption', seat: 0, card: 25, options: ['draw'], cancellable: true });
    click('Cancel');
    expect(b).toEqual([null]);
  });

  it('pickCards: grouped with counts, stops at max', () => {
    const a = ask({ kind: 'pickCards', seat: 0, card: 22, pool: [29, 29, 14, 7], max: 3 });
    expect(root.textContent).toContain('×2');
    click('Wall Section 1');
    click('Wall Section 1');
    expect(buttons().some(x => x.getAttribute('aria-label')?.startsWith('Wall Section 1,'))).toBe(false);   // none left
    click('Man Hour');
    expect(a).toEqual([[29, 29, 14]]);
  });

  it('pickCards: Done takes the picks so far, and putting one back works', () => {
    const a = ask({ kind: 'pickCards', seat: 0, card: 27, pool: [29, 14, 7], max: 3 });
    click('Man Hour');
    click('Debt');
    click('Put back Man Hour');
    click('Done');
    expect(a).toEqual([[7]]);
  });

  it('pickCards: the timer takes the picks when it runs out', () => {
    vi.useFakeTimers();
    const a = ask({ kind: 'pickCards', seat: 0, card: 11, pool: [29, 14], max: 4 });
    click('Man Hour');
    act(() => { vi.advanceTimersByTime((PICK_SECONDS - 1) * 1000); });
    expect(a).toEqual([]);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(a).toEqual([[14]]);
  });
});

describe('pass screen', () => {
  it('ignores the first moment, then "I\'m ready" passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const ready = vi.fn();
    act(() => render(<PassScreen name="Ben" why="It's your turn." onReady={ready} />, root));
    expect(root.textContent).toContain('Pass the device to');
    expect(root.textContent).toContain("It's your turn.");
    click("I'm Ben - show me");
    expect(ready).not.toHaveBeenCalled();
    vi.setSystemTime(1_000_000 + PASS_GUARD_MS);
    click("I'm Ben - show me");
    expect(ready).toHaveBeenCalledTimes(1);
  });
});

describe('win screen', () => {
  it('shows the winner, the reason and everyone\'s miles, best first', () => {
    const onAgain = vi.fn(), onMenu = vi.fn();
    act(() => render(<WinScreen result={{ winners: [1], miles: [8, 27, 3], reason: 'Someone built 3 sets of 3 walls.' }}
      view={view()} onAgain={onAgain} onMenu={onMenu} />, root));
    expect(root.textContent).toContain('Ben wins!');
    expect(root.textContent).toContain('Someone built 3 sets of 3 walls.');
    const who = [...root.querySelectorAll('.btw-win-who')].map(e => e.textContent);
    expect(who).toEqual(['Ben', 'Ann', 'Cat']);
    expect(root.textContent).toContain('27 miles');
    click('Play again');
    expect(onAgain).toHaveBeenCalled();
  });

  it('a tie names everyone tied', () => {
    act(() => render(<WinScreen result={{ winners: [0, 2], miles: [10, 3, 10], reason: 'r' }} view={view()} onAgain={() => {}} onMenu={() => {}} />, root));
    expect(root.textContent).toContain("It's a tie: Ann & Cat");
  });
});

describe('turn recap', () => {
  const v = view();
  const ev = (e: Partial<GameEvent> & Pick<GameEvent, 'type'>): GameEvent => ({ text: '', ...e });

  it('collects what others did to you since your last turn, in your words', () => {
    const events: GameEvent[] = [
      ev({ type: 'turnStart', seat: 0 }),
      ev({ type: 'wallMoved', seat: 1, target: 0, card: 31, text: "Wall Section 3 moved from Ben's walls to Ann's walls." }),  // on Ann's own turn
      ev({ type: 'turnEnd', seat: 0 }),
      ev({ type: 'turnStart', seat: 1 }),
      ev({ type: 'play', seat: 1, card: 7 }),
      ev({ type: 'wallMoved', seat: 0, target: 1, card: 29, text: "Wall Section 1 moved from Ann's walls to Ben's walls." }),
      ev({ type: 'play', seat: 1, card: 9 }),
      ev({ type: 'limited', seat: 1, target: 0, card: 9, text: 'Ann gets only 1 action next turn.' }),
      ev({ type: 'turnEnd', seat: 1 }),
      ev({ type: 'turnStart', seat: 0 }),
    ];
    const lines = recapFor(events, 0, v);
    expect(lines.map(l => l.text)).toEqual([
      "Wall Section 1 moved from your walls to Ben's walls.",
      'You get only 1 action next turn.',
    ]);
    expect(lines[0]).toMatchObject({ card: 7, lost: [29] });
    expect(lines[1]!.card).toBe(9);
    expect(passWhy(events, 0, v)).toContain("It's your turn.");
  });

  it('a Play Immediately card another player drew is explained', () => {
    const events: GameEvent[] = [
      ev({ type: 'turnEnd', seat: 0 }),
      ev({ type: 'immediate', seat: 1, card: 8 }),
      ev({ type: 'cardMoved', seat: 1, target: 0, card: 14, text: 'Ben gave a card to Ann.' }),
    ];
    const [line] = recapFor(events, 0, v);
    expect(line!.text).toBe('Ben drew Deep State, a Play Immediately card. Ben gave a card to you.');
    expect(line!.got).toEqual([14]);
  });

  it('steals show the cards you lost', () => {
    const events: GameEvent[] = [
      ev({ type: 'turnEnd', seat: 0 }),
      ev({ type: 'play', seat: 2, card: 6 }),
      ev({ type: 'cardMoved', seat: 2, target: 0, card: 6, cards: [14, 7], text: 'Cat took 2 cards from Ann.' }),
    ];
    expect(recapFor(events, 0, v)[0]).toMatchObject({ text: 'Cat took 2 cards from you.', lost: [14, 7] });
  });

  it('"you" replaces your name, but not other names that contain it', () => {
    expect(personal("Ann's walls and Annie's walls", 'Ann')).toBe("Your walls and Annie's walls");
    expect(personal('Ann is in Quarantine.', 'Ann')).toBe('You are in Quarantine.');
  });

  it('renders with an OK button that closes it', () => {
    const close = vi.fn();
    act(() => render(<Recap lines={[{ text: 'Cat took 2 cards from you.', card: 6, lost: [14] }]} myTurn onClose={close} />, root));
    expect(root.textContent).toContain('WHILE YOU WERE AWAY');
    expect(root.textContent).toContain('Lost');
    click("OK, it's my turn");
    expect(close).toHaveBeenCalled();
  });
});

describe('Overlays with a real game', () => {
  const settings = (players: number, bots: number) => ({ players, bots, difficulties: Array(bots).fill('medium'), names: [],
    ending: 1 as const, endingTimes: 1 as const, actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] });

  it('two humans: the pass screen comes up and "ready" hands over', async () => {
    const c = new GameController({ passScreen: true });
    void c.start(settings(2, 0), 5);
    await new Promise(r => setTimeout(r, 0));
    act(() => render(<Overlays controller={c} />, root));
    expect(root.textContent).toContain('Pass the device to');
    const realNow = Date.now;
    Date.now = () => realNow() + PASS_GUARD_MS + 1;
    try { click('show me'); } finally { Date.now = realNow; }
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(c.snapshot.get().passTo).toBeNull();
    expect(root.textContent).not.toContain('Pass the device to');
  });

  it('a finished bots-only game shows the win screen', async () => {
    const c = new GameController();
    await c.start(settings(3, 3), 11);
    act(() => render(<Overlays controller={c} />, root));
    expect(root.textContent).toMatch(/wins!|It's a tie/);
    expect(root.textContent).toContain('Back to menu');
  });
});

describe('wallToastFor', () => {
  it("tells you when someone else's card takes or gives you a wall, not about your own moves", () => {
    const took = { type: 'wallMoved' as const, seat: 1, target: 0, card: 31, text: 'Ben took Wall Section 3 from Ann.' };
    expect(wallToastFor(took, 0)).toEqual({ text: 'Ben took Wall Section 3 from Ann.', tone: 'alert' });
    expect(wallToastFor(took, 1)).toBeNull();                                         // Ben did it
    expect(wallToastFor({ ...took, seat: 0, target: 0 }, 0)).toBeNull();               // pulling your own wall back
    expect(wallToastFor({ ...took, type: 'build' }, 0)).toBeNull();
  });
});
