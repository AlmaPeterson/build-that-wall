import { describe, expect, it } from 'vitest';
import { makeState } from '../effects/test-context';
import { CardLedger, CardLedgerInvariantError } from './card-ledger';

describe('CardLedger', () => {
  it('gives every physical card an opaque unique identity, including held cards', () => {
    const state = makeState([
      { hand: [14], walls: [29] },
      { hand: [20] },
    ], {
      draw: [16], discard: [17], jail: [18],
      trainGuards: [{ seat: 0, kind: 29 }],
    });
    state.seats[1]!.limitNext = 9;

    const entries = new CardLedger(state).snapshot();

    expect(entries).toHaveLength(8);
    expect(new Set(entries.map(entry => entry.instance.id)).size).toBe(8);
    expect(entries.find(entry => entry.location.zone === 'limit')?.card).toBe(9);
    expect(entries.find(entry => entry.location.zone === 'trainGuard')?.instance.card).toBe(25);
  });

  it('preserves an instance through draw, hand, and discard transfers', () => {
    const state = makeState([{ hand: [] }, { hand: [] }], { draw: [20, 14] });
    const ledger = new CardLedger(state);
    const drawn = ledger.snapshot().find(entry => entry.location.zone === 'draw' && entry.location.index === 1)!;

    state.seats[0]!.hand.push(state.draw.pop()!);
    const drawMove = ledger.reconcile(state);
    expect(drawMove).toEqual([expect.objectContaining({
      instance: drawn.instance,
      kind: 'transfer',
      from: { zone: 'draw', index: 1 },
      to: { zone: 'hand', seat: 0, index: 0 },
    })]);

    state.discard.push(state.seats[0]!.hand.pop()!);
    const discardMove = ledger.reconcile(state);
    expect(discardMove).toEqual([expect.objectContaining({
      instance: drawn.instance,
      kind: 'transfer',
      from: { zone: 'hand', seat: 0, index: 0 },
      to: { zone: 'discard', index: 0 },
    })]);
  });

  it('reports a hand closing its gap as a reposition, not a new card', () => {
    const state = makeState([{ hand: [14, 14, 20] }, { hand: [] }]);
    const ledger = new CardLedger(state);
    const twenty = ledger.snapshot().find(entry => entry.card === 20)!;

    state.discard.push(state.seats[0]!.hand.splice(0, 1)[0]!);
    const moves = ledger.reconcile(state);

    expect(moves).toContainEqual(expect.objectContaining({
      instance: twenty.instance,
      kind: 'reposition',
      from: { zone: 'hand', seat: 0, index: 2 },
      to: { zone: 'hand', seat: 0, index: 1 },
    }));
  });

  it('moves Trump Train into its held guard location', () => {
    const state = makeState([{ hand: [25], walls: [29, 29] }, { hand: [] }]);
    const ledger = new CardLedger(state);
    const train = ledger.snapshot()[0]!;

    state.seats[0]!.hand.pop();
    state.trainGuards.push({ seat: 0, kind: 29 });
    expect(ledger.reconcile(state)).toEqual([expect.objectContaining({
      instance: train.instance,
      from: { zone: 'hand', seat: 0, index: 0 },
      to: { zone: 'trainGuard', seat: 0, wall: 29, index: 0 },
    })]);
  });

  it('rejects cards that silently appear or disappear', () => {
    const state = makeState([{ hand: [14] }, { hand: [] }]);
    const ledger = new CardLedger(state);

    state.seats[0]!.hand.pop();
    expect(() => ledger.reconcile(state)).toThrow(CardLedgerInvariantError);
    expect(() => ledger.reconcile(state)).toThrow('disappeared without a destination');

    const fresh = new CardLedger(state);
    state.draw.push(20);
    expect(() => fresh.reconcile(state)).toThrow('appeared without a source');
  });
});
