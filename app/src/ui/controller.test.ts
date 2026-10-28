import { describe, expect, it } from 'vitest';
import { GameController } from './controller';

const settings = (players: number, bots: number) => ({
  players, bots, difficulties: Array(bots).fill('medium'), names: [], ending: 1 as const, endingTimes: 1 as const,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [],
});

describe('GameController', () => {
  it('bots wait for the board to finish showing each move', async () => {
    const c = new GameController();
    let release: () => void = () => {};
    let waits = 0;
    c.setPace(() => { waits++; return new Promise(r => { release = r; }); });
    const done = c.start(settings(2, 2), 5);
    await new Promise(r => setTimeout(r, 0));
    const before = c.snapshot.get().events.length;
    await new Promise(r => setTimeout(r, 5));
    expect(c.snapshot.get().events.length).toBe(before);     // stuck until the board is ready
    expect(waits).toBe(1);
    c.setPace(null);
    release();
    await done;
    expect(c.snapshot.get().view?.over).not.toBeNull();
  });

  it('a bots-only game runs to the end and publishes the result', async () => {
    const c = new GameController();
    await c.start(settings(3, 3), 11);
    const snap = c.snapshot.get();
    expect(snap.view?.over).not.toBeNull();
    expect(snap.events.at(-1)?.type).toBe('gameOver');
  });

  it("shows only the viewer's hand and waits for the human to act", async () => {
    const c = new GameController();
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    const snap = c.snapshot.get();
    expect(snap.view).not.toBeNull();
    expect(snap.viewer).toBe(0);
    expect(snap.view!.seats[1]!.hand.every(id => id === 4)).toBe(true);   // the bot's hand is hidden
    if (snap.view!.turn === 0 && !snap.prompt) {
      expect((await c.act({ type: 'endTurn' })).ok).toBe(true);
    }
  });

  it("one person playing: shows \"Player 1's turn\" for a moment, with the hand hidden, before the turn starts", async () => {
    const c = new GameController({ turnBanner: 30 });
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    const during = c.snapshot.get();
    expect(during.turnBanner).toBe(0);
    expect(during.events.some(e => e.type === 'turnStart')).toBe(false);   // the turn hasn't started yet
    await new Promise(r => setTimeout(r, 50));
    expect(c.snapshot.get().turnBanner).toBeNull();
    expect(c.snapshot.get().events.some(e => e.type === 'turnStart' && e.seat === 0)).toBe(true);
    c.stop();
  });

  it('shows the pass-the-device screen between two humans', async () => {
    const c = new GameController({ passScreen: true });
    void c.start(settings(2, 0), 5);
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().passTo).toBe(0);
    c.ready();
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().passTo).toBeNull();
  });
});

describe('a card being played', () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  /** You (seat 0) against a bot, on your turn, with `hand`; the bot has built `botWalls`. */
  async function myTurn(hand: number[], botWalls: number[] = []) {
    for (let seed = 1; seed < 100; seed++) {
      const c = new GameController();
      void c.start(settings(2, 1), seed);
      await tick();
      if (c.snapshot.get().view?.turn !== 0 || c.snapshot.get().prompt) { c.stop(); continue; }
      const s = c.api!.state;
      s.seats[0]!.hand = [...hand];
      s.seats[1]!.walls = [...botWalls];
      s.actionsLeft = 3;
      c.refresh();
      return c;
    }
    throw new Error('no seed starts on your turn');
  }

  it("stays in your hand on screen while you answer its question; backing out leaves it there", async () => {
    const c = await myTurn([7, 29], [30]);
    const events = c.snapshot.get().events.length;
    const done = c.act({ type: 'play', slot: 0 });                  // Debt: pick a wall
    await tick();
    const asking = c.snapshot.get();
    expect(asking.prompt?.decision.kind).toBe('chooseWall');
    expect(asking.view!.seats[0]!.hand).toEqual([7, 29]);          // not gone yet
    asking.prompt!.answer(null);                                     // back out
    expect((await done).reason).toBe('Cancelled.');
    expect(c.snapshot.get().view!.seats[0]!.hand).toEqual([7, 29]);
    expect(c.snapshot.get().events.length).toBe(events);             // nothing happened
  });

  it('a card that goes to the discard pile before its question is still shown in your hand meanwhile', async () => {
    const c = await myTurn([22, 29]);                                // Supreme Court Nominee: pick from the draw pile
    void c.act({ type: 'play', slot: 0 });
    await tick();
    const asking = c.snapshot.get();
    expect(asking.prompt?.decision.kind).toBe('pickCards');
    expect(asking.view!.seats[0]!.hand).toEqual([22, 29]);
    expect(asking.view!.discard).not.toContain(22);
    expect(c.api!.state.discard.at(-1)).toBe(22);                    // (the game itself has discarded it)
    asking.prompt!.answer([] as never);
    await tick();
    expect(c.snapshot.get().view!.seats[0]!.hand).toEqual([29]);
    expect(c.snapshot.get().events.some(e => e.type === 'play' && e.card === 22)).toBe(true);
  });
});

describe('GameController on a shared device', () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  /** Answer every open question with its first option (and tap through pass screens) until the game waits for an action. */
  async function settle(c: GameController) {
    for (let i = 0; i < 50; i++) {
      const { prompt, passTo } = c.snapshot.get();
      if (passTo !== null) c.ready();
      else if (!prompt) return;
      else {
        const d = prompt.decision as import('../game').Decision;
        const first = d.kind === 'block' || d.kind === 'paySavings' ? false
          : d.kind === 'pickCards' ? [] : 'options' in d ? d.options[0] ?? null : null;
        prompt.answer(first as never);
      }
      await tick();
    }
  }

  it("hands the device to another player for their decision, then back", async () => {
    const c = new GameController({ passScreen: true });
    void c.start(settings(2, 0), 5);
    await tick();
    c.ready();                                   // player 1 takes the device for their turn
    await tick();
    await settle(c);                             // answer anything the opening draw asks (Play Immediately cards)
    const s = c.state as import('../game').GameState;
    expect(s.turn).toBe(0);
    // Player 1 plays Controlled Opposition on player 2, who holds a Self-Defense
    s.seats[0]!.hand.push(6);
    s.seats[1]!.hand.push(20);
    s.actionsLeft = 3;
    c.refresh();
    const played = c.act({ type: 'play', slot: s.seats[0]!.hand.length - 1 });
    await tick();
    expect(c.snapshot.get().prompt?.decision.kind).toBe('chooseSeat');   // player 1 is still holding it
    c.snapshot.get().prompt!.answer(1);
    await tick();
    expect(c.snapshot.get().passTo).toBe(1);                             // pass to player 2 first
    expect(c.snapshot.get().prompt).toBeNull();
    c.ready();
    await tick();
    expect(c.snapshot.get().viewer).toBe(1);
    expect(c.snapshot.get().prompt?.decision.kind).toBe('block');
    c.snapshot.get().prompt!.answer(true);
    await played;
    await tick();
    expect(c.snapshot.get().passTo).toBe(0);                             // and back to player 1
    c.ready();
    await tick();
    expect(c.snapshot.get().viewer).toBe(0);
  });

  it("never shows another player's drawn cards in the events", async () => {
    const c = new GameController({ passScreen: true });
    void c.start(settings(2, 0), 9);
    await tick();
    const { events, viewer } = c.snapshot.get();
    for (const e of events.filter(e => (e.type === 'deal' || e.type === 'draw') && e.seat !== viewer)) {
      expect(e.cards?.every(id => id === 4) ?? true).toBe(true);
    }
  });

  it('stop() ends a running game: bots stop and nothing more is published', async () => {
    const c = new GameController({ watchDelay: 5 });
    void c.start(settings(3, 3), 2);
    await new Promise(r => setTimeout(r, 30));
    c.stop();
    const n = c.snapshot.get().events.length;
    await new Promise(r => setTimeout(r, 50));
    expect(c.snapshot.get().events.length).toBe(n);
    expect(c.state!.over).toBeNull();
  });
});
