import { describe, expect, it } from 'vitest';
import type { CardId, Ending } from '../types';
import { CARD_BACK, redactEvent, viewFor } from './view';
import { begin, filler, MH, scriptedBot, setup, stubRules, WALL1, WALL2, WALL3, WALL4 } from './test-kit';

const SET3 = (k: number) => [k, k, k];
/** Walls for 3 full sets (48 miles). */
const THREE_SETS = [...SET3(29), ...SET3(30), ...SET3(31)];

describe('dealing and drawing', () => {
  it('a random player goes first unless firstSeat says who', async () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const { game, state } = setup({ seed, settings: { players: 4, firstSeat: undefined } });
      await game.start();
      firsts.add(state.turn);                                   // no bots: the game waits for the first player
    }
    expect(firsts.size).toBeGreaterThan(1);
    const { game, state } = setup({ seed: 7, settings: { players: 4, firstSeat: 2 } });
    await game.start();
    expect(state.turn).toBe(2);
  });

  it('deals 5 rounds, one card per seat per round, from the top of the pile', async () => {
    const draw = Array.from({ length: 20 }, (_, i) => 100 + i);   // top = 119
    const { game, state } = setup({ draw: draw as CardId[] });
    await game.start();
    // Round 1: seat 0 gets 119, seat 1 gets 118; round 2: 117, 116 ...
    expect(state.seats[0]!.hand.slice(0, 5)).toEqual([119, 117, 115, 113, 111]);
    expect(state.seats[1]!.hand).toEqual([118, 116, 114, 112, 110]);
    // Then seat 0's first turn draws 3 more
    expect(state.seats[0]!.hand.slice(5)).toEqual([109, 108, 107]);
    expect(state.turn).toBe(0);
    expect(state.actionsLeft).toBe(3);
    expect(state.turnCount).toBe(1);
  });

  it('shuffles the discard pile in when the draw pile is empty', async () => {
    const { game, state } = setup({ draw: [] });
    state.discard = [MH, MH, 19, 20];
    await begin(game, state, [[], []]);
    expect(state.seats[0]!.hand).toHaveLength(3);
    expect(state.draw.length + state.seats[0]!.hand.length).toBe(4);
    expect(state.discard).toEqual([]);
  });

  it('draws nothing when both piles are empty', async () => {
    const { game, state } = setup({ draw: [] });
    await begin(game, state, [[], []]);
    expect(state.seats[0]!.hand).toEqual([]);
  });
});

describe('the draw pile running out', () => {
  // Seat 0's first turn takes the last 3 cards. The discard pile has 3 more for the second run-out.
  async function run(ending: Ending, endingTimes: 1 | 2) {
    const t = setup({ settings: { ending, endingTimes }, draw: filler(3) });
    await begin(t.game, t.state, [[], []]);
    const afterFirst = { count: t.state.exhaustCount, final: t.state.final };
    t.state.discard = filler(3);
    await t.game.act(0, { type: 'endTurn' });            // seat 1 reshuffles and empties the pile again
    return { ...t, afterFirst };
  }

  for (const ending of [1, 2, 3, 4] as Ending[]) {
    for (const times of [1, 2] as const) {
      it(`ending ${ending}, ${times} time(s)`, async () => {
        const { state, afterFirst, events } = await run(ending, times);
        expect(afterFirst.count).toBe(1);
        expect(state.exhaustCount).toBe(2);
        if (ending === 1) {
          expect(afterFirst.final).toBeNull();
          expect(state.final).toBeNull();
        } else if (times === 1) {
          expect(afterFirst.final).toEqual({ kind: 'deck', stop: 0, reason: '' });
        } else {
          expect(afterFirst.final).toBeNull();
          expect(events.some(e => e.text.startsWith('The draw pile ran out (1 of 2 times)'))).toBe(true);
          expect(state.final).toEqual({ kind: 'deck', stop: 1, reason: '' });
        }
      });
    }
  }

  it('counts an empty pile only once while it stays empty', async () => {
    const { game, state } = setup({ settings: { ending: 1 }, draw: filler(3) });
    await begin(game, state, [[], []]);
    await game.act(0, { type: 'endTurn' });
    await game.act(1, { type: 'endTurn' });
    expect(state.exhaustCount).toBe(1);
  });
});

describe('endings', () => {
  it('3 sets start a final round; everyone else gets one more turn; most miles wins', async () => {
    const { game, state, events } = setup({ settings: { ending: 1, players: 3 }, draw: filler(30) });
    state.seats[0]!.walls = [...THREE_SETS];
    await begin(game, state, [[], [], []]);
    expect(state.final).toEqual({ kind: 'sets', stop: 0, reason: 'Someone built 3 sets of 3 walls.' });
    await game.act(0, { type: 'endTurn' });
    expect(state.over).toBeNull();
    await game.act(1, { type: 'endTurn' });
    expect(state.over).toBeNull();
    await game.act(2, { type: 'endTurn' });
    expect(state.over).toEqual({ winners: [0], miles: [48, 0, 0], reason: 'Someone built 3 sets of 3 walls.' });
    expect(events.at(-1)!.text).toBe('Player 1 wins! Someone built 3 sets of 3 walls. Most miles: 48.');
  });

  it('ending 2 ignores sets and ends after the deck final round', async () => {
    const { game, state } = setup({ settings: { ending: 2 }, draw: filler(3) });
    state.seats[1]!.walls = [...THREE_SETS];
    await begin(game, state, [[], []]);
    expect(state.final?.kind).toBe('deck');
    await game.act(0, { type: 'endTurn' });
    expect(state.over).toBeNull();
    await game.act(1, { type: 'endTurn' });
    expect(state.over?.reason).toBe('The deck ran out and the final turns are done.');
    expect(state.over?.winners).toEqual([1]);
  });

  it('ending 3 ends on whichever happens first', async () => {
    const { game, state } = setup({ settings: { ending: 3 }, draw: filler(30) });
    state.seats[0]!.walls = [...THREE_SETS];
    await begin(game, state, [[], []]);
    expect(state.final?.kind).toBe('sets');
    await game.act(0, { type: 'endTurn' });
    await game.act(1, { type: 'endTurn' });
    expect(state.over?.reason).toBe('Someone built 3 sets of 3 walls.');
  });

  it('ending 4: a deck final round without 3 sets lets play go on until someone has 3 sets', async () => {
    const { game, state } = setup({ settings: { ending: 4 }, draw: filler(3) });
    await begin(game, state, [[], []]);
    expect(state.final?.kind).toBe('deck');
    state.discard = filler(30);
    await game.act(0, { type: 'endTurn' });
    await game.act(1, { type: 'endTurn' });             // deck final round over, nobody has 3 sets
    expect(state.over).toBeNull();
    expect(state.deckDone).toBe(true);
    expect(state.final).toBeNull();
    expect(state.turn).toBe(0);
    state.seats[1]!.walls = [...THREE_SETS];
    await game.act(0, { type: 'endTurn' });             // seat 1's turn start: both conditions → sets final round
    expect(state.final).toEqual({ kind: 'sets', stop: 1, reason: 'Both the deck and 3 sets are done.' });
    await game.act(1, { type: 'endTurn' });
    await game.act(0, { type: 'endTurn' });
    expect(state.over?.reason).toBe('Both the deck and 3 sets are done.');
  });

  it('ties share the win', async () => {
    const { game, state, events } = setup({ settings: { ending: 1 }, draw: filler(30) });
    state.seats[0]!.walls = [...THREE_SETS];
    state.seats[1]!.walls = [...SET3(32), ...SET3(33), ...SET3(34)];
    await begin(game, state, [[], []]);
    await game.act(0, { type: 'endTurn' });
    await game.act(1, { type: 'endTurn' });
    expect(state.over?.winners).toEqual([0, 1]);
    expect(events.at(-1)!.text).toMatch(/^It's a tie: Player 1 & Player 2/);
  });

  it('a seat that leaves an online game ends it if only one is left', async () => {
    const { game, state } = setup({ draw: filler(30) });
    await begin(game, state, [[], []]);
    await game.leave(1);
    expect(state.over?.reason).toBe('Everyone else left the game.');
  });
});

describe('building', () => {
  it('with a Man Hour: 1 action, the Man Hour is discarded', async () => {
    const { game, state, events } = setup({ draw: filler(30) });
    await begin(game, state, [[WALL1, 7, 7], []]);       // the turn draws 3 Man Hours: hand = [29, 7, 7, MH, MH, MH]
    expect(await game.act(0, { type: 'build', slot: 0, pay: { manHour: 3 } })).toEqual({ ok: true });
    expect(state.seats[0]!.walls).toEqual([WALL1]);
    expect(state.seats[0]!.hand).toEqual([7, 7, MH, MH]);
    expect(state.discard).toEqual([MH]);
    expect(state.actionsLeft).toBe(2);
    expect(events.some(e => e.type === 'build' && e.text === 'Player 1 built Wall Section 1 with a Man Hour.')).toBe(true);
  });

  it('with 2 other walls', async () => {
    const { game, state } = setup({ draw: [] });
    await begin(game, state, [[WALL1, WALL2, 7, WALL3], []]);
    expect(await game.act(0, { type: 'build', slot: 3, pay: { walls: [0, 1] } })).toEqual({ ok: true });
    expect(state.seats[0]!.walls).toEqual([WALL3]);
    expect(state.seats[0]!.hand).toEqual([7]);
    expect(state.discard).toEqual([WALL1, WALL2]);
  });

  it('refuses bad builds', async () => {
    const { game, state } = setup({ draw: [] });
    await begin(game, state, [[WALL1, WALL2, 7, MH], []]);
    expect((await game.act(0, { type: 'build', slot: 2, pay: { manHour: 3 } })).ok).toBe(false);     // not a wall
    expect((await game.act(0, { type: 'build', slot: 0, pay: { manHour: 2 } })).ok).toBe(false);     // not a Man Hour
    expect((await game.act(0, { type: 'build', slot: 0, pay: { walls: [1, 2] } })).ok).toBe(false);  // 7 isn't a wall
    expect((await game.act(0, { type: 'build', slot: 0, pay: { walls: [0, 1] } })).ok).toBe(false);  // can't pay with itself
    expect((await game.act(0, { type: 'build', slot: 9, pay: { manHour: 3 } })).ok).toBe(false);     // empty slot
    expect((await game.act(1, { type: 'build', slot: 0, pay: { manHour: 3 } })).ok).toBe(false);     // not their turn
    state.actionsLeft = 0;
    expect(await game.act(0, { type: 'build', slot: 0, pay: { manHour: 3 } })).toEqual({ ok: false, reason: 'No actions left.' });
    expect(state.seats[0]!.walls).toEqual([]);
  });

  it('lists build options: Man Hour first, then 2 other walls', async () => {
    const { game, state } = setup({ draw: [] });
    await begin(game, state, [[WALL1, MH, WALL2, WALL3], []]);
    expect(game.buildOptions(0)).toEqual([
      { slot: 0, pay: { manHour: 1 } }, { slot: 0, pay: { walls: [2, 3] } },
      { slot: 2, pay: { manHour: 1 } }, { slot: 2, pay: { walls: [0, 3] } },
      { slot: 3, pay: { manHour: 1 } }, { slot: 3, pay: { walls: [0, 2] } },
    ]);
    expect(game.buildOptions(1)).toEqual([]);
  });

  it('a guarded pair that becomes a set loses its Trump Train', async () => {
    const { game, state } = setup({ draw: [] });
    state.seats[0]!.walls = [WALL1, WALL1];
    state.trainGuards = [{ seat: 0, kind: WALL1 }];
    await begin(game, state, [[WALL1, MH], []]);
    await game.act(0, { type: 'build', slot: 0, pay: { manHour: 1 } });
    expect(state.trainGuards).toEqual([]);
    expect(state.discard).toEqual([MH, 25]);
  });
});

describe('playing cards', () => {
  it('pays the cost, runs the effect, and refunds if the player backs out', async () => {
    const rules = stubRules({ 9: async () => false });
    const { game, state } = setup({ rules, draw: [] });
    await begin(game, state, [[26, 9], []]);
    expect(await game.act(0, { type: 'play', slot: 0 })).toEqual({ ok: true });   // Trump costs 1
    expect(state.actionsLeft).toBe(2);
    expect(state.discard).toEqual([26]);
    expect(await game.act(0, { type: 'play', slot: 0 })).toEqual({ ok: false, reason: 'Cancelled.' });
    expect(state.seats[0]!.hand).toEqual([9]);
    expect(state.actionsLeft).toBe(2);
    expect(rules.runs.map(r => r.card)).toEqual([26, 9]);
  });

  it('refuses cards that cost too much, walls, and cards the rules forbid', async () => {
    const { game, state } = setup({ draw: [] });
    await begin(game, state, [[26, WALL1, 20], []]);
    state.actionsLeft = 0;
    expect(game.canPlay(0, 0)).toEqual({ ok: false, reason: 'Not enough actions left.' });
    expect(game.canPlay(0, 1).ok).toBe(false);
    expect(game.canPlay(0, 2)).toEqual({ ok: false, reason: 'Only used to block.' });
    expect(game.canPlay(1, 0).ok).toBe(false);
  });

  it('effects can ask for a block; a block discards the Self-Defense', async () => {
    let blocked: boolean | undefined;
    const rules = stubRules({ 9: async ctx => { blocked = await ctx.defend(1, 0, 9); ctx.discard(9); return true; } });
    const { game, state, asked } = setup({ rules, draw: [] });
    await begin(game, state, [[9], [20, MH]]);
    await game.act(0, { type: 'play', slot: 0 });
    expect(blocked).toBe(true);
    expect(asked).toEqual([{ kind: 'block', seat: 1, attacker: 0, card: 9 }]);
    expect(state.seats[1]!.hand).toEqual([MH]);
    expect(state.discard).toEqual([20, 9]);
  });
});

describe('one thing at a time', () => {
  it('refuses actions while a card is waiting for an answer', async () => {
    let answer!: (v: boolean) => void;
    const rules = stubRules({ 9: async ctx => { await ctx.defend(1, 0, 9); ctx.discard(9); return true; } });
    const { game, state } = setup({ rules, draw: [] });
    (game as unknown as { opts: { deciderFor(): unknown } }).opts.deciderFor = () => ({
      decide: () => new Promise<boolean>(res => { answer = res; }),
    });
    await begin(game, state, [[9, 26], [20]]);
    const playing = game.act(0, { type: 'play', slot: 0 });
    await Promise.resolve();
    expect((await game.act(0, { type: 'endTurn' })).ok).toBe(false);
    answer(false);
    expect(await playing).toEqual({ ok: true });
    expect((await game.act(0, { type: 'play', slot: 0 })).ok).toBe(true);
  });
});

describe('Play Immediately cards', () => {
  it('are played from the start of the hand, one after another, after drawing', async () => {
    const rules = stubRules();
    const { game, state } = setup({ rules, draw: [] });
    await begin(game, state, [[MH, 12, WALL1, 8], [1]]);
    expect(rules.immediates).toEqual([{ seat: 0, card: 12 }, { seat: 0, card: 8 }]);
    expect(state.seats[0]!.hand).toEqual([MH, WALL1]);
    expect(state.discard).toEqual([12, 8]);
    expect(state.seats[1]!.hand).toEqual([1]);           // only the current player's hand
  });

  it('stop after 21 in a row', async () => {
    const rules = stubRules({}, async ctx => { ctx.addToHand(ctx.player, 10); });
    const { game, state } = setup({ rules, draw: [] });
    await begin(game, state, [[10], []]);
    expect(rules.immediates).toHaveLength(21);
  });

  it('run after a played card too', async () => {
    const rules = stubRules({ 26: async ctx => { ctx.discard(26); ctx.addToHand(0, 18); return true; } });
    const { game, state } = setup({ rules, draw: [] });
    await begin(game, state, [[26], []]);
    await game.act(0, { type: 'play', slot: 0 });
    expect(rules.immediates).toEqual([{ seat: 0, card: 18 }]);
  });
});

describe('turn start effects', () => {
  it('releases the jail when its turn count comes', async () => {
    const { game, state } = setup({ draw: filler(30) });
    state.jail = [11, 22];
    state.jailRelease = 3;
    await begin(game, state, [[], []]);
    expect(state.jail).toEqual([11, 22]);              // turn 1
    await game.act(0, { type: 'endTurn' });             // turn 2
    expect(state.jail).toEqual([11, 22]);
    await game.act(1, { type: 'endTurn' });             // turn 3
    expect(state.jail).toEqual([]);
    expect(state.discard).toEqual([11, 22]);
  });

  it('a limit card gives 1 action and is then discarded', async () => {
    const { game, state } = setup({ draw: filler(30) });
    state.seats[1]!.limitNext = 9;
    await begin(game, state, [[], []]);
    await game.act(0, { type: 'endTurn' });
    expect(state.actionsLeft).toBe(1);
    expect(state.seats[1]!.limitNext).toBe(0);
    expect(state.discard).toEqual([9]);
  });

  it('Quarantine: draw, then skip the turn, with no second block offer', async () => {
    const { game, state, asked, events } = setup({ draw: filler(30) });
    state.seats[1]!.skipNext = true;
    await begin(game, state, [[], [20]]);
    await game.act(0, { type: 'endTurn' });
    expect(asked).toEqual([]);
    expect(state.seats[1]!.hand).toEqual([20, MH, MH, MH]);
    expect(state.seats[1]!.skipNext).toBe(false);
    expect(state.discard).toEqual([17]);
    expect(state.turn).toBe(0);
    expect(events.some(e => e.type === 'skipped' && e.seat === 1)).toBe(true);
  });

  it('seats that left get no turns', async () => {
    const { game, state } = setup({ settings: { players: 3 }, draw: filler(30) });
    await begin(game, state, [[], [], []]);
    await game.leave(1);
    await game.act(0, { type: 'endTurn' });
    expect(state.turn).toBe(2);
    expect(state.seats[1]!.hand).toEqual([]);
  });

  it('a final round still ends if the seat that started it has left', async () => {
    const { game, state } = setup({ settings: { players: 3, ending: 1 }, draw: filler(30) });
    state.seats[0]!.walls = [...THREE_SETS];
    await begin(game, state, [[], [], []]);
    await game.act(0, { type: 'endTurn' });
    await game.leave(0);
    await game.act(1, { type: 'endTurn' });
    await game.act(2, { type: 'endTurn' });
    expect(state.over?.winners).toEqual([0]);
  });
});

describe('bots', () => {
  it('take their turn through the BotPlayer until they stop', async () => {
    const bot = scriptedBot([{ type: 'build', slot: 0, pay: { manHour: 1 } }]);
    const { game, state } = setup({ settings: { bots: 1 }, draw: filler(30), bot });
    await begin(game, state, [[], [WALL4]]);
    await game.act(0, { type: 'endTurn' });             // the bot builds, stops, and it's seat 0 again
    expect(state.seats[1]!.walls).toEqual([WALL4]);
    expect(bot.calls).toBe(2);
    expect(state.turn).toBe(0);
    expect((await game.act(1, { type: 'endTurn' })).ok).toBe(false);
  });

  it('a game of bots plays itself to the end', async () => {
    const bot = {
      nextAction(api: import('../contracts').GameApi, seat: number) {
        const opt = api.buildOptions(seat)[0];
        return opt ? { type: 'build' as const, slot: opt.slot, pay: opt.pay } : { type: 'endTurn' as const };
      },
    };
    const { game, state } = setup({ settings: { players: 3, bots: 3, ending: 3 }, seed: 5, bot });
    await game.start();
    expect(state.over).not.toBeNull();
  });
});

describe('what each player sees', () => {
  it('hides other hands, the draw order and the seed', async () => {
    const { game, state } = setup({ seed: 3 });
    await game.start();
    const v = viewFor(state, 1);
    expect(v.seats[1]!.hand).toEqual(state.seats[1]!.hand);
    expect(v.seats[0]!.hand).toEqual(state.seats[0]!.hand.map(() => CARD_BACK));
    expect(v.draw).toEqual(state.draw.map(() => CARD_BACK));
    expect(v.rng).toBe(0);
    expect(v.discard).toEqual(state.discard);
    expect(state.seats[0]!.hand).not.toContain(CARD_BACK);   // the real state is untouched
  });

  it('can show every hand (a bots-only game), still hiding the draw order and the seed', async () => {
    const { game, state } = setup({ seed: 3 });
    await game.start();
    const v = viewFor(state, 1, true);
    expect(v.seats.map(s => s.hand)).toEqual(state.seats.map(s => s.hand));
    expect(v.draw).toEqual(state.draw.map(() => CARD_BACK));
    expect(v.rng).toBe(0);
  });

  it('hides which cards others drew', () => {
    const e = { type: 'draw' as const, seat: 0, cards: [29, 30], text: 'Player 1 drew 2 cards.' };
    expect(redactEvent(e, 1).cards).toEqual([4, 4]);
    expect(redactEvent(e, 0).cards).toEqual([29, 30]);
  });

  it('the state survives a JSON round trip', async () => {
    const { game, state } = setup({ seed: 9 });
    await game.start();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('the play event', () => {
  it('names the player the card was played on', async () => {
    const rules = stubRules({
      6: async ctx => {
        ctx.discard(6);
        const target = await ctx.decide({ kind: 'chooseSeat', seat: ctx.player, card: 6, options: [1], cancellable: false });
        ctx.emit({ type: 'cardMoved', seat: ctx.player, target: target!, text: 'took cards' });
        return true;
      },
    });
    const { game, state, events } = setup({ rules, answer: d => (d.kind === 'chooseSeat' ? 1 : null), draw: filler(20) });
    await begin(game, state, [[6], [MH]]);
    await game.act(0, { type: 'play', slot: 0 });
    const play = events.find(e => e.type === 'play')!;
    expect(play).toMatchObject({ seat: 0, card: 6, target: 1, text: 'Player 1 played Controlled Opposition on Player 2.' });
    expect(events.indexOf(play)).toBeLessThan(events.findIndex(e => e.type === 'cardMoved'));
  });

  it('has no target for a card played on nobody', async () => {
    const { game, state, events } = setup({ draw: filler(20) });
    await begin(game, state, [[26], [MH]]);
    await game.act(0, { type: 'play', slot: 0 });
    expect(events.find(e => e.type === 'play')!.target).toBeUndefined();
  });
});

describe('blocking', () => {
  // Plays card 6 on seat 1, who holds Self-Defense; discards it after the block answer, like the real effects
  function blockGame(block: boolean) {
    let eventsWhenAsked = -1;
    const rules = stubRules({
      6: async ctx => {
        const target = (await ctx.decide({ kind: 'chooseSeat', seat: 0, card: 6, options: [1], cancellable: false }))!;
        const blocked = await ctx.defend(target, 0, 6);
        ctx.discard(6);
        if (!blocked) ctx.emit({ type: 'cardMoved', seat: 0, target, card: 6, text: 'took cards' });
        return true;
      },
    });
    const t = setup({
      rules, draw: filler(20),
      answer: d => {
        if (d.kind === 'chooseSeat') return 1;
        if (d.kind === 'block') { eventsWhenAsked = t.events.length; return block; }
        return null;
      },
    });
    return { ...t, asked: () => eventsWhenAsked };
  }

  it('the target sees the card played on them before being asked to block', async () => {
    const t = blockGame(true);
    await begin(t.game, t.state, [[6], [20, MH]]);
    await t.game.act(0, { type: 'play', slot: 0 });
    expect(t.events.slice(0, t.asked()).at(-1)).toMatchObject({ type: 'play', card: 6, target: 1 });
  });

  it('"blocked" is announced once the blocked card is in the discard pile too', async () => {
    const t = blockGame(true);
    const discardWhenBlocked: number[][] = [];
    const game = t.game as unknown as { emitFn: (e: { type: string }) => void };
    const emit = game.emitFn;
    game.emitFn = e => { if (e.type === 'blocked') discardWhenBlocked.push([...t.state.discard]); emit(e); };
    await begin(t.game, t.state, [[6], [20, MH]]);
    await t.game.act(0, { type: 'play', slot: 0 });
    expect(discardWhenBlocked).toEqual([[20, 6]]);
  });
});
