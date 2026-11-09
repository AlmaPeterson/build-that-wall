import { describe, expect, it } from 'vitest';
import { CARD_BACK } from '../game';
import { GameController, type SavedGame } from './controller';

const settings = (players: number, bots: number) => ({
  players, bots, difficulties: Array(bots).fill('medium'), names: [], ending: 1 as const, endingTimes: 1 as const,
  actionsPerTurn: 3, cardsPerTurn: 3, packCards: [], firstSeat: 0,
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

  it('a bots-only game shows every hand face up', async () => {
    const c = new GameController();
    let release: () => void = () => {};
    c.setPace(() => new Promise(r => { release = r; }));
    const done = c.start(settings(3, 3), 7);
    await new Promise(r => setTimeout(r, 0));
    const snap = c.snapshot.get();
    expect(snap.openHands).toBe(true);
    expect(snap.view!.seats.flatMap(s => s.hand)).not.toContain(CARD_BACK);
    expect(snap.view!.seats.some(s => s.hand.length)).toBe(true);
    c.setPace(null);
    release();
    await done;
  });

  it("shows only the viewer's hand and waits for the human to act", async () => {
    const c = new GameController();
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    const snap = c.snapshot.get();
    expect(snap.view).not.toBeNull();
    expect(snap.viewer).toBe(0);
    expect(snap.view!.seats[1]!.hand.every(id => id === 4)).toBe(true);   // the bot's hand is hidden
    expect(snap.openHands).toBe(false);
    if (snap.view!.turn === 0 && !snap.prompt) {
      expect((await c.act({ type: 'endTurn' })).ok).toBe(true);
    }
  });

  it('a quarantined human: the game waits for their OK before going on to the next turn', async () => {
    const c = new GameController();
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().view!.turn).toBe(0);
    c.api!.state.seats[0]!.skipNext = true;
    const ended = c.act({ type: 'endTurn' });                     // the bot's turn, then the skipped one
    await new Promise(r => setTimeout(r, 10));
    const held = c.snapshot.get();
    expect(held.skipped).toBe(0);
    expect(held.view!.turn).toBe(0);                               // not moved on behind the notice
    expect(held.events.at(-1)?.type).toBe('skipped');
    c.skipSeen();
    await new Promise(r => setTimeout(r, 10));
    const after = c.snapshot.get();
    expect(after.skipped).toBeNull();
    expect((await ended).ok).toBe(true);
    expect(after.events.filter(e => e.type === 'turnStart').length).toBeGreaterThan(held.events.filter(e => e.type === 'turnStart').length);
    c.stop();
  });

  it("shows \"Player 1's turn\" and draws that player's cards only after OK", async () => {
    const c = new GameController({ turnBanner: true });
    void c.start(settings(2, 1), 3);
    await new Promise(r => setTimeout(r, 0));
    const during = c.snapshot.get();
    expect(during.turnBanner).toBe(0);
    expect(during.events.some(e => e.type === 'turnStart' && e.seat === 0)).toBe(true);
    expect(during.events.some(e => e.type === 'draw' && e.seat === 0)).toBe(false);
    await new Promise(r => setTimeout(r, 30));
    expect(c.snapshot.get().turnBanner).toBe(0);                            // it waits, however long it takes
    c.turnOk();
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().turnBanner).toBeNull();
    expect(c.snapshot.get().events.some(e => e.type === 'draw' && e.seat === 0)).toBe(true);
    c.stop();
  });

  it('a bot draws without waiting for anyone', async () => {
    const c = new GameController({ turnBanner: true });
    void c.start({ ...settings(2, 2), firstSeat: 0 }, 3);
    await new Promise(r => setTimeout(r, 0));
    expect(c.snapshot.get().turnBanner).toBeNull();
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
    expect(await done).toEqual({ ok: false, reason: 'Cancelled.' });
    expect(c.snapshot.get().view!.seats[0]!.hand).toEqual([7, 29]);
    expect(c.snapshot.get().events.length).toBe(events);             // nothing happened
  });

  it("a building card's \"pick the walls\" names its cards, so they're right while the screen still shows the card", async () => {
    const c = await myTurn([26, 3, 29, 14, 30]);                    // Assassin in slot 1: build up to 2 walls free
    void c.act({ type: 'play', slot: 1 });
    await tick();
    const asking = c.snapshot.get();
    const d = asking.prompt!.decision as { kind: string; options: number[]; cards: number[] };
    expect(d.kind).toBe('pickHandCards');
    expect(asking.view!.seats[0]!.hand).toEqual([26, 3, 29, 14, 30]);   // Assassin still shown
    expect(d.cards).toEqual([29, 30]);                               // the choices are the two walls
    asking.prompt!.answer([d.options[1]!] as never);                 // Wall Section 2 only
    await tick();
    expect(c.api!.state.seats[0]!.walls).toEqual([30]);
    expect(c.api!.state.discard).toContain(3);
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

  describe('saving and carrying on', () => {
    it("saves at a person's move and a new controller carries on from there", async () => {
      const saves: (SavedGame | null)[] = [];
      const c = new GameController({ onSave: s => saves.push(s) });
      await c.start(settings(2, 1), 3);                     // you go first: the game waits for your move
      const last = saves.at(-1)!;
      expect(last).toMatchObject({ v: 1, at: 'move' });
      expect(last.state.turn).toBe(0);
      // The saved copy doesn't change with the running game
      const hand = [...last.state.seats[0]!.hand];
      c.state!.seats[0]!.hand.push(14);
      expect(last.state.seats[0]!.hand).toEqual(hand);
      c.state!.seats[0]!.hand.pop();

      const d = new GameController({ onSave: s => saves.push(s) });
      await d.resume(JSON.parse(JSON.stringify(last)));      // as it comes back from localStorage
      expect(d.state).toEqual(c.state);
      expect(d.snapshot.get().events).toHaveLength(c.snapshot.get().events.length);
      // ...and plays on: ending the turn runs the bot and comes back to you
      const r = await d.act({ type: 'endTurn' });
      expect(r.ok).toBe(true);
      expect(d.state!.turn === 0 || d.state!.over).toBeTruthy();
      expect(saves.at(-1) === null || saves.at(-1)!.state.turnCount > last.state.turnCount).toBe(true);
    });

    it('a save from the start of a turn starts that turn again; a finished game is forgotten', async () => {
      const saves: (SavedGame | null)[] = [];
      const c = new GameController({ onSave: s => saves.push(s) });
      await c.start(settings(3, 3), 11);                    // bots only, to the end
      expect(saves.at(-1)).toBeNull();
      const turn = [...saves].reverse().find(s => s?.at === 'turn')!;
      const d = new GameController();
      await d.resume(turn);
      expect(d.state!.over).not.toBeNull();                 // ran on to an end
      expect(d.state!.turnCount).toBeGreaterThanOrEqual(turn.state.turnCount);
    });

    it("Pass'n'Play: carrying on mid-turn shows the pass screen first", async () => {
      const saves: (SavedGame | null)[] = [];
      const c = new GameController({ passScreen: true, onSave: s => saves.push(s) });
      void c.start(settings(2, 0), 4);
      await new Promise(r => setTimeout(r, 0));
      c.ready();
      await new Promise(r => setTimeout(r, 0));
      const move = [...saves].reverse().find(s => s?.at === 'move')!;
      expect(move).toBeTruthy();
      const d = new GameController({ passScreen: true });
      void d.resume(move);
      expect(d.snapshot.get().passTo).toBe(move.state.turn);
    });
  });
});
