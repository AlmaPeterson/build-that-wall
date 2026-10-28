import { describe, expect, it } from 'vitest';
import { createGame, DEFAULT_SETTINGS, viewFor, type GameState } from '../../game';
import { diffViews, midView } from './moves';

const B = 4;   // card back

function game(hands: number[][], extra: Partial<GameState> = {}): GameState {
  const s = createGame({ ...DEFAULT_SETTINGS, players: hands.length, bots: 0 }, 1);
  s.draw = [14, 14, 14, 29, 30];
  s.discard = [];
  hands.forEach((h, i) => { s.seats[i]!.hand = [...h]; });
  return Object.assign(s, extra);
}
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

describe('diffViews', () => {
  it('a played card goes from the hand slot to the discard pile', () => {
    const a = game([[29, 26, 14], [30]]);
    const b = clone(a);
    b.seats[0]!.hand.splice(1, 1);
    b.discard.push(26);
    expect(diffViews(viewFor(a, 0), viewFor(b, 0))).toEqual([
      { card: 26, from: { at: 'hand', seat: 0, slot: 1 }, to: { at: 'discard' } },
    ]);
  });

  it('building: the wall goes to the built walls, the Man Hour to the discard pile', () => {
    const a = game([[29, 14, 30], [31]]);
    const b = clone(a);
    b.seats[0]!.hand = [30];
    b.seats[0]!.walls.push(29);
    b.discard.push(14);
    const moves = diffViews(viewFor(a, 0), viewFor(b, 0));
    expect(moves).toContainEqual({ card: 29, from: { at: 'hand', seat: 0, slot: 0 }, to: { at: 'walls', seat: 0, kind: 29 } });
    expect(moves).toContainEqual({ card: 14, from: { at: 'hand', seat: 0, slot: 1 }, to: { at: 'discard' } });
    expect(moves).toHaveLength(2);
  });

  it("another player's draw stays face down; your own is shown", () => {
    const a = game([[29], [30]]);
    const b = clone(a);
    b.seats[1]!.hand.push(b.draw.pop()!);
    expect(diffViews(viewFor(a, 0), viewFor(b, 0))).toEqual([{ card: B, from: { at: 'draw' }, to: { at: 'hand', seat: 1, slot: 1 } }]);
    expect(diffViews(viewFor(a, 1), viewFor(b, 1))).toEqual([{ card: 30, from: { at: 'draw' }, to: { at: 'hand', seat: 1, slot: 1 } }]);
  });

  it("a bot's hidden card is shown once it's played", () => {
    const a = game([[29], [7, 30, 31]]);
    a.seats[0]!.walls = [33];
    const b = clone(a);
    b.seats[1]!.hand = [30, 31];
    b.discard.push(7);
    b.seats[0]!.walls = [];
    b.seats[1]!.walls = [33];
    const moves = diffViews(viewFor(a, 0), viewFor(b, 0), { played: { seat: 1, card: 7 } });
    // Which slot it was in stays hidden; only that it left that player's hand
    expect(moves.find(m => m.card === 7)).toMatchObject({ from: { at: 'hand', seat: 1 }, to: { at: 'discard' } });
    expect(moves).toContainEqual({ card: 33, from: { at: 'walls', seat: 0, kind: 33 }, to: { at: 'walls', seat: 1, kind: 33 } });
  });

  it('a card held nowhere (Quarantine) goes to the player it was played on', () => {
    const a = game([[17, 29], [30]]);
    const b = clone(a);
    b.seats[0]!.hand = [29];
    b.seats[1]!.skipNext = true;
    expect(diffViews(viewFor(a, 0), viewFor(b, 0), { fallback: { at: 'seat', seat: 1 } }))
      .toEqual([{ card: 17, from: { at: 'hand', seat: 0, slot: 0 }, to: { at: 'seat', seat: 1 } }]);
  });

  it('shuffling the draw pile moves nothing; shuffling the discard pile in moves every card', () => {
    const a = game([[29], [30]]);
    a.discard = [14, 26];
    const b = clone(a);
    b.draw.reverse();
    expect(diffViews(viewFor(a, 0), viewFor(b, 0))).toEqual([]);
    b.draw.push(...b.discard.splice(0));
    const moves = diffViews(viewFor(a, 0), viewFor(b, 0));
    expect(moves.map(m => [m.from.at, m.to.at])).toEqual([['discard', 'draw'], ['discard', 'draw']]);
  });

  it('a Trump Train guard and a Democrat Border limit are places too', () => {
    const a = game([[25, 9], [30]]);
    a.seats[0]!.walls = [31, 31];
    const b = clone(a);
    b.seats[0]!.hand = [9];
    b.trainGuards.push({ seat: 0, kind: 31 });
    expect(diffViews(viewFor(a, 0), viewFor(b, 0))).toEqual([{ card: 25, from: { at: 'hand', seat: 0, slot: 0 }, to: { at: 'guard', seat: 0, kind: 31 } }]);
    const c = clone(b);
    c.seats[0]!.hand = [];
    c.seats[1]!.limitNext = 9;
    expect(diffViews(viewFor(b, 0), viewFor(c, 0))).toEqual([{ card: 9, from: { at: 'hand', seat: 0, slot: 0 }, to: { at: 'limit', seat: 1 } }]);
  });
});

describe('midView', () => {
  it('takes moving cards out of where they were without putting them anywhere yet', () => {
    const a = game([[29, 14, 30], [31]]);
    const b = clone(a);
    b.seats[0]!.hand = [30];
    b.seats[0]!.walls.push(29);
    b.discard.push(14);
    const mid = midView(viewFor(a, 0), diffViews(viewFor(a, 0), viewFor(b, 0)));
    expect(mid.seats[0]!.hand).toEqual([30]);
    expect(mid.seats[0]!.walls).toEqual([]);
    expect(mid.discard).toEqual([]);
  });
});
