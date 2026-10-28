import { describe, expect, it } from 'vitest';
import { baseDeck, cardById, cards, catalogue, isWall } from './cards';
import assets from './assets.json';

// Facts from docs/game-rules.md section 3
describe('card catalogue', () => {
  it('has 49 cards with ids 1-49 in order', () => {
    expect(cards.map((c) => c.id)).toEqual(Array.from({ length: 49 }, (_, i) => i + 1));
  });

  it('builds the 107-card base deck', () => {
    const deck = baseDeck();
    expect(deck).toHaveLength(107);
    expect(catalogue.deckSize).toBe(107);
    const count = (id: number) => deck.filter((d) => d === id).length;
    expect(count(14)).toBe(16); // Man Hour
    expect(count(7)).toBe(7); // Debt
    expect(count(20)).toBe(5); // Self Defense
    expect(count(26)).toBe(4); // Trump
    expect(count(19)).toBe(3); // Savings
    expect(count(25)).toBe(3); // Trump Train
    for (let id = 29; id <= 44; id++) expect(count(id)).toBe(3);
    expect(deck.filter((d) => d >= 45)).toHaveLength(0); // pack cards are not in the base deck
  });

  it('marks wall sections, immediates and costs', () => {
    expect(cards.filter((c) => c.category === 'wall').map((c) => c.id)).toEqual(
      cards.filter((c) => isWall(c.id)).map((c) => c.id),
    );
    expect(cards.filter((c) => c.playImmediately).map((c) => c.id)).toEqual([1, 2, 8, 10, 12, 15, 18, 24]);
    expect(cardById(7).cost).toBe(1);
    expect(cardById(3).cost).toBe(0);
    expect(cardById(21).blockable).toBe(false);
  });

  it('gives every real card an effect and a picture that exists', () => {
    const files = new Set(
      Object.values(assets.sprites).flatMap((s) => Object.values(s.costumes).map((c) => c.path)),
    );
    for (const c of cards) {
      expect(c.effect.length).toBeGreaterThan(0);
      expect(files.has(c.image.card)).toBe(true);
      if (c.category !== 'placeholder') expect(c.effects.length).toBeGreaterThan(0);
    }
  });
});
