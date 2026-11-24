// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { COACH_STEPS, Coach, coach, nextCoach, skipCoach, startCoach } from './coach';

let root: HTMLDivElement | null = null;
afterEach(() => { if (root) { render(null, root); root.remove(); root = null; } document.body.innerHTML = ''; coach.set(null); });

/** A pretend board with every part the coach points at. */
function board() {
  for (const cls of ['stage', 'hand', 'walls-none', 'score--miles', 'side__end-turn']) {
    const el = document.createElement('div');
    el.className = cls;
    el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 80, right: 300, bottom: 180, x: 100, y: 100, toJSON() {} }) as DOMRect;
    document.body.append(el);
  }
  root = document.createElement('div');
  document.body.append(root);
  act(() => { render(<Coach />, root!); });
}

describe('the first-game coach', () => {
  it('has four short steps, each pointing at a part of the board', () => {
    expect(COACH_STEPS.map(s => s.title)).toEqual(['Your cards', 'Build your wall', 'Score miles', '3 actions a turn']);
    expect(COACH_STEPS.every(s => s.text.length < 100)).toBe(true);
  });

  it('goes step by step to "Let\'s play!", and Skip ends it at any time', () => {
    board();
    expect(document.querySelector('.coach')).toBeNull();
    act(() => { startCoach(); });
    expect(document.querySelector('.coach__head')!.textContent).toContain('Your cards');
    expect(document.querySelector('.coach__skip')).not.toBeNull();
    act(() => { nextCoach(); nextCoach(); nextCoach(); });
    expect(document.querySelector('.coach__head')!.textContent).toContain('3 actions a turn');
    expect(document.querySelector('.coach__next')!.textContent).toBe("Let's play!");
    expect(document.querySelector('.coach__skip')).toBeNull();
    act(() => { (document.querySelector('.coach__next') as HTMLButtonElement).click(); });
    expect(coach.get()).toBeNull();
    expect(document.querySelector('.coach')).toBeNull();

    act(() => { startCoach(); });
    act(() => { (document.querySelector('.coach__skip') as HTMLButtonElement).click(); });
    expect(coach.get()).toBeNull();
    act(() => { skipCoach(); });
    expect(coach.get()).toBeNull();
  });
});
