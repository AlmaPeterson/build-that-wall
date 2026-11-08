// A visual identity ledger for the physical cards in a GameState.
//
// The rules engine deliberately stores cards as CardId numbers, because most
// game rules only care about a card's face.  The client, however, needs to
// know *which copy* moved so it can keep one card in one place while it is
// animated.  This class supplies that identity without changing the rules
// representation.  Call `reconcile` immediately after an atomic state change;
// it returns every instance's old and new location, or rejects a state that
// created/lost a physical card.
import type { CardId, CardLocation, CardMove, GameState } from '../types';

/** Stable only for the lifetime of one CardLedger. Safe to use as a UI key. */
export interface CardInstance {
  readonly id: string;
  readonly card: CardId;
}

/**
 * `reposition` is a card whose slot changed within one collection (for
 * example, a hand closing its gap). `transfer` crossed between collections.
 * Consumers can animate these differently, but both preserve identity.
 */
export interface LedgerMove extends Omit<CardMove, 'instance'> {
  readonly instance: CardInstance;
}

interface LocatedCard {
  readonly card: CardId;
  readonly location: CardLocation;
}

export interface CardLedgerEntry extends LocatedCard {
  readonly instance: CardInstance;
}

interface TrackedCard extends CardLedgerEntry {}

/** A state has a different number of a card than the ledger's last snapshot. */
export class CardLedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardLedgerInvariantError';
  }
}

/**
 * Keeps opaque identities alongside a raw GameState.
 *
 * Equal card faces are indistinguishable to the rules, so when two equal
 * copies move in one atomic change the ledger chooses a deterministic pairing.
 * It first preserves copies that stayed in the same collection, then pairs the
 * remaining copies by their stable collection order. That is enough for a UI:
 * identical faces never visibly swap identities.
 */
export class CardLedger {
  private nextId = 1;
  private current: TrackedCard[];

  constructor(state: GameState) {
    this.current = this.locate(state).map(entry => ({
      ...entry,
      instance: this.createInstance(entry.card),
    }));
  }

  /**
   * Replaces the baseline without reporting motion. Use this only for a fresh
   * game, restoring a saved game, or deliberately accepting an external state
   * snapshot. Normal game mutations must use reconcile instead.
   */
  reset(state: GameState): void {
    this.current = this.locate(state).map(entry => ({
      ...entry,
      instance: this.createInstance(entry.card),
    }));
  }

  /** A read-only copy of the current instance-to-location mapping. */
  snapshot(): readonly CardLedgerEntry[] {
    return this.current.map(entry => ({
      instance: entry.instance,
      card: entry.card,
      location: { ...entry.location },
    }));
  }

  /**
   * Reconcile the next state against the previous one. This is intentionally
   * strict: a card cannot appear or disappear silently. A caller that receives
   * a complete replacement state must call reset(), not reconcile().
   */
  reconcile(state: GameState): readonly LedgerMove[] {
    const next = this.locate(state);
    this.assertSameInventory(next);

    const unused = new Set(this.current);
    const assigned: TrackedCard[] = [];

    // Keep identities in their existing collection whenever possible. This
    // avoids falsely saying every card moved when a neighbor was removed from a
    // hand, draw pile, or wall row.
    for (const card of cardIds(next)) {
      const previousByCollection = groupBy(
        this.current.filter(entry => entry.card === card),
        entry => collectionKey(entry.location),
      );
      const nextByCollection = groupBy(
        next.filter(entry => entry.card === card),
        entry => collectionKey(entry.location),
      );
      for (const key of sortedKeys(nextByCollection)) {
        const oldEntries = previousByCollection.get(key) ?? [];
        const newEntries = nextByCollection.get(key) ?? [];
        const count = Math.min(oldEntries.length, newEntries.length);
        for (let i = 0; i < count; i++) {
          const oldEntry = oldEntries[i]!;
          unused.delete(oldEntry);
          assigned.push({ ...newEntries[i]!, instance: oldEntry.instance });
        }
      }
    }

    // Pair every remaining copy of a face deterministically. At this point it
    // must be a real cross-collection transfer; inventory was checked above.
    for (const card of cardIds(next)) {
      const oldEntries = this.current.filter(entry => entry.card === card && unused.has(entry));
      // `assigned` stores locations, so use a key set rather than object
      // identity to distinguish the next entries already paired above.
      const assignedKeys = new Set(assigned.filter(entry => entry.card === card).map(entry => locationKey(entry.location)));
      const unassignedNext = next.filter(entry => entry.card === card && !assignedKeys.has(locationKey(entry.location)));
      if (oldEntries.length !== unassignedNext.length) {
        // assertSameInventory means this is only possible if a collection was
        // malformed; keep the failure close to the source of the problem.
        throw new CardLedgerInvariantError('Could not pair all copies of card ' + card + '.');
      }
      oldEntries.sort(compareLocated);
      unassignedNext.sort(compareLocated);
      for (let i = 0; i < oldEntries.length; i++) {
        const oldEntry = oldEntries[i]!;
        const newEntry = unassignedNext[i]!;
        unused.delete(oldEntry);
        assigned.push({ ...newEntry, instance: oldEntry.instance });
      }
    }

    if (unused.size !== 0 || assigned.length !== next.length) {
      throw new CardLedgerInvariantError('Could not reconcile every physical card.');
    }

    const previousByInstance = new Map(this.current.map(entry => [entry.instance.id, entry]));
    const moves: LedgerMove[] = assigned.flatMap(entry => {
      const previous = previousByInstance.get(entry.instance.id)!;
      if (locationKey(previous.location) === locationKey(entry.location)) return [];
      return [{
        instance: entry.instance,
        card: entry.card,
        from: previous.location,
        to: entry.location,
        kind: collectionKey(previous.location) === collectionKey(entry.location) ? 'reposition' : 'transfer',
      }];
    });
    this.current = assigned;
    return moves;
  }

  private createInstance(card: CardId): CardInstance {
    return { id: 'card-' + this.nextId++, card };
  }

  private assertSameInventory(next: readonly LocatedCard[]): void {
    const before = countCards(this.current);
    const after = countCards(next);
    for (const card of new Set([...before.keys(), ...after.keys()])) {
      const oldCount = before.get(card) ?? 0;
      const newCount = after.get(card) ?? 0;
      if (oldCount === newCount) continue;
      const direction = newCount > oldCount ? 'appeared without a source' : 'disappeared without a destination';
      const difference = Math.abs(newCount - oldCount);
      throw new CardLedgerInvariantError(
        'Card ' + card + ' ' + direction + ' (' + difference + ' ' + (difference === 1 ? 'copy' : 'copies') + ').',
      );
    }
  }

  private locate(state: GameState): LocatedCard[] {
    const out: LocatedCard[] = [];
    const add = (card: CardId, location: CardLocation) => { out.push({ card, location }); };
    state.draw.forEach((card, index) => add(card, { zone: 'draw', index }));
    state.discard.forEach((card, index) => add(card, { zone: 'discard', index }));
    state.jail.forEach((card, index) => add(card, { zone: 'jail', index }));
    (state.resolving ?? []).forEach((card, index) => add(card, { zone: 'resolving', index }));
    state.seats.forEach((seat, player) => {
      seat.hand.forEach((card, index) => add(card, { zone: 'hand', seat: player, index }));
      seat.walls.forEach((card, index) => add(card, { zone: 'wall', seat: player, index }));
      if (seat.limitNext > 0) add(seat.limitNext, { zone: 'limit', seat: player });
      if ((seat.quarantine ?? 0) > 0) add(seat.quarantine!, { zone: 'quarantine', seat: player });
    });
    state.trainGuards.forEach((guard, index) => add(25, {
      zone: 'trainGuard', seat: guard.seat, wall: guard.kind, index,
    }));
    return out;
  }
}

function countCards(entries: readonly { card: CardId }[]): Map<CardId, number> {
  const out = new Map<CardId, number>();
  for (const entry of entries) out.set(entry.card, (out.get(entry.card) ?? 0) + 1);
  return out;
}

function cardIds(entries: readonly { card: CardId }[]): CardId[] {
  return [...new Set(entries.map(entry => entry.card))].sort((a, b) => a - b);
}

function groupBy<T>(entries: readonly T[], keyFor: (entry: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyFor(entry);
    const group = out.get(key);
    if (group) group.push(entry);
    else out.set(key, [entry]);
  }
  return out;
}

function sortedKeys<T>(map: ReadonlyMap<string, T>): string[] {
  return [...map.keys()].sort();
}

function collectionKey(location: CardLocation): string {
  switch (location.zone) {
    case 'draw': case 'discard': case 'jail': case 'resolving': return location.zone;
    case 'hand': case 'wall': return location.zone + ':' + location.seat;
    case 'limit': case 'quarantine': return location.zone + ':' + location.seat;
    case 'trainGuard': return 'trainGuard:' + location.seat + ':' + location.wall;
  }
}

function locationKey(location: CardLocation): string {
  switch (location.zone) {
    case 'draw': case 'discard': case 'jail': case 'resolving': return collectionKey(location) + ':' + location.index;
    case 'hand': case 'wall': return collectionKey(location) + ':' + location.index;
    case 'limit': case 'quarantine': return collectionKey(location);
    case 'trainGuard': return collectionKey(location) + ':' + location.index;
  }
}

function compareLocated(a: LocatedCard, b: LocatedCard): number {
  return locationKey(a.location).localeCompare(locationKey(b.location));
}
