import { describe, expect, it } from 'vitest';
import { keepKeys } from './Hand';

const fresh = () => { let n = 0; return () => 'new' + n++; };

describe('keepKeys', () => {
  it('keeps the key of a card that stays when an equal card before it leaves', () => {
    const before = { cards: [43, 37, 33, 37, 44], keys: ['a', 'b', 'c', 'd', 'e'] };
    expect(keepKeys(before, [43, 33, 37, 44], fresh())).toEqual(['a', 'c', 'd', 'e']);
    expect(keepKeys(before, [43, 37, 33, 44], fresh())).toEqual(['a', 'b', 'c', 'e']);
  });

  it('gives new cards new keys, wherever they go', () => {
    const before = { cards: [1, 2], keys: ['a', 'b'] };
    expect(keepKeys(before, [1, 2, 2], fresh())).toEqual(['a', 'b', 'new0']);
    expect(keepKeys(before, [3, 1, 2], fresh())).toEqual(['new0', 'a', 'b']);
    expect(keepKeys({ cards: [], keys: [] }, [5, 5], fresh())).toEqual(['new0', 'new1']);
  });
});
