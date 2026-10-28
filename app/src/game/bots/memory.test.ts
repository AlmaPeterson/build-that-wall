import { describe, expect, it } from 'vitest';
import { createBotMemory, learnFromEvent } from './memory';
import { makeState, memStore } from './test-api';

describe('bot memory', () => {
  it('reads and updates the old "aimem" format', () => {
    const store = memStore({ aimem: JSON.stringify({ Alma: { games: 2, debt: 3, attack: 1, miles: 50 }, Sam: { games: 1, debt: 0, attack: 0, miles: 9 } }) });
    const m = createBotMemory(store);
    expect(m.rate('Alma', 'miles')).toBe(25);
    expect(m.rate(' Alma ', 'debt')).toBe(1.5);
    m.learn('Alma', 'game', 30);
    m.learn('Alma', 'attack');
    expect(JSON.parse(store.get('aimem')!)).toEqual({
      Alma: { games: 3, debt: 3, attack: 2, miles: 80 }, Sam: { games: 1, debt: 0, attack: 0, miles: 9 },
    });
    expect(m.rate('Alma', 'miles')).toBe(27);
  });

  it('starts empty, ignores blank names and survives bad data', () => {
    const store = memStore({ aimem: 'not json' });
    const m = createBotMemory(store);
    expect(m.rate('Nobody', 'debt')).toBe(0);
    m.learn('  ', 'debt');
    expect(store.get('aimem')).toBe('not json');
    m.learn('New', 'debt');
    expect(m.rate('New', 'debt')).toBe(1);        // debts per game, with games counted as at least 1
  });
});

describe('learning from events', () => {
  const setup = () => {
    const store = memStore();
    const m = createBotMemory(store);
    const s = makeState([{ name: 'Alma' }, { bot: 'hard', name: 'Bot 2' }, { name: 'Sam' }]);
    return { m, s, store };
  };

  it('counts each Debt a human plays once', () => {
    const { m, s } = setup();
    learnFromEvent(m, { type: 'play', text: 'Alma played Debt', seat: 0, card: 7 }, s);
    learnFromEvent(m, { type: 'wallMoved', text: 'Debt took a wall', seat: 0, card: 7 }, s);
    learnFromEvent(m, { type: 'savings', text: 'Sam paid with Savings', seat: 2, card: 7 }, s);
    expect(m.rate('Alma', 'debt')).toBe(1);
    expect(m.rate('Sam', 'debt')).toBe(0);
  });

  it('puts attacks down to the human who played them, and ignores bots', () => {
    const { m, s, store } = setup();
    learnFromEvent(m, { type: 'play', text: '', seat: 2, card: 17 }, s);
    learnFromEvent(m, { type: 'play', text: '', seat: 1, card: 7 }, s);
    learnFromEvent(m, { type: 'play', text: '', seat: 0, card: 26 }, s);
    expect(JSON.parse(store.get('aimem')!)).toEqual({ Sam: { games: 0, debt: 0, attack: 1, miles: 0 } });
  });

  it("records every human's miles at the end of the game", () => {
    const { m, s } = setup();
    s.over = { winners: [1], miles: [20, 40, 11], reason: '' };
    learnFromEvent(m, { type: 'gameOver', text: 'Game over' }, s);
    expect(m.rate('Alma', 'miles')).toBe(20);
    expect(m.rate('Sam', 'miles')).toBe(11);
    expect(m.rate('Bot 2', 'miles')).toBe(0);
  });
});
