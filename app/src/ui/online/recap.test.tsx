// @vitest-environment happy-dom
// Online: the "While you were away" recap only ever shows on the device of the player whose turn it is.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from '../app-state';
settings.update(s => ({ ...s, animSpeed: 'off' }));
import { createGame, viewFor, type GameEvent, type GameState } from '../../game';
import { Overlays } from '../overlays/Overlays';
import { OnlineClientController } from './client';

let root: HTMLElement;
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
afterEach(() => { render(null, root); root.remove(); });

function game(): GameState {
  const s = createGame({ players: 3, bots: 0, difficulties: [], names: ['Ann', 'Ben', 'Cat'], ending: 1, endingTimes: 1,
    actionsPerTurn: 3, cardsPerTurn: 3, packCards: [] }, 1);
  s.seats[0]!.walls = [31]; s.turn = 1;
  return s;
}

// Ann (the host, seat 0) took a wall from Ben (seat 1) on her turn; now it's Ben's turn
const events: GameEvent[] = [
  { type: 'gameStart', text: 'A new game with 3 players.' },
  { type: 'turnStart', seat: 0, text: "It's Ann's turn." },
  { type: 'wallMoved', seat: 1, target: 0, card: 31, text: "Wall Section 3 moved from Ben's walls to Ann's walls." },
  { type: 'turnEnd', seat: 0, text: 'Ann ended their turn.' },
  { type: 'turnStart', seat: 1, text: "It's Ben's turn." },
];

function showOn(seat: number): string {
  const c = new OnlineClientController(() => {});
  c.receive({ k: 'snap', seat, view: viewFor(game(), seat), events, from: 0, total: events.length });
  act(() => render(<Overlays controller={c} />, root));
  return root.textContent ?? '';
}

describe('online recap', () => {
  it("shows on Ben's device at the start of his turn", () => {
    expect(showOn(1)).toContain('WHILE YOU WERE AWAY');
  });
  it("never on another player's device", () => {
    expect(showOn(2)).not.toContain('WHILE YOU WERE AWAY');
  });
});
