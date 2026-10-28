import { describe, expect, it, vi } from 'vitest';
import { SERVER, fakeApi, makeStore } from '../account/test-fakes';
import { Leaderboard, WORLD_BOARD_MAX, mergeWorldBoard, topTen, type Board, type WorldBoardTransport } from './leaderboard';

const stats = (games: number, wins: number, best: number, walls = 0, spent = 0) => ({ games, wins, best, walls, spent });

describe('mergeWorldBoard', () => {
  it('numbers only go up, and new players are added', () => {
    const out = mergeWorldBoard({ A: { ...stats(5, 2, 30), at: 1 } }, { A: stats(3, 3, 40), B: stats(1, 0, 5) }, 99);
    expect(out.A).toEqual({ ...stats(5, 3, 40), at: 99 });
    expect(out.B).toEqual({ ...stats(1, 0, 5), at: 99 });
  });

  it('keeps the most recently updated players', () => {
    const board: Board = {};
    for (let i = 0; i < WORLD_BOARD_MAX + 5; i++) board['p' + i] = { ...stats(1, 0, 1), at: i };
    const out = mergeWorldBoard(board, { fresh: stats(1, 1, 1) }, 1e9);
    expect(Object.keys(out)).toHaveLength(WORLD_BOARD_MAX);
    expect(out.fresh).toBeDefined();
    expect(out.p0).toBeUndefined();
  });
});

describe('topTen', () => {
  const rows = [
    { name: 'A', ...stats(10, 5, 30, 4, 2.5) },
    { name: 'B', ...stats(4, 4, 50, 9) },
    { name: 'C', ...stats(0, 0, 0) },
  ];

  it('formats each board', () => {
    expect(topTen(rows, 'miles')).toEqual(['1.  B   50 miles', '2.  A   30 miles']);
    expect(topTen(rows, 'rate')).toEqual(['1.  A   50% of 10 games']);   // 5+ games only
    expect(topTen(rows, 'walls')[0]).toBe('1.  B   9 walls built');
    expect(topTen(rows, 'spent')).toEqual(['1.  A   2.50 spent']);
    expect(topTen(rows, 'unknown')[0]).toBe('1.  B   50 miles');
  });
});

describe('Leaderboard', () => {
  it('records games on this device', () => {
    const { store } = makeStore();
    const lb = new Leaderboard(store, fakeApi({}).api);
    lb.recordLocal(' Alex ', true, 20, 2);
    lb.recordLocal('Alex', false, 10, 1);
    lb.recordLocal('', true, 99, 9);
    expect(lb.local()).toEqual({ Alex: stats(2, 1, 20, 3, 0) });
  });

  it('adds money spent under the player\'s name', () => {
    const { store } = makeStore();
    store.set('name', 'Sam');
    const lb = new Leaderboard(store, fakeApi({}).api);
    lb.addSpent(2.99); lb.addSpent(0.01);
    expect(lb.local().Sam!.spent).toBe(3);
  });

  it('uses the game server board when there is one', async () => {
    const { store } = makeStore();
    const lb = new Leaderboard(store, fakeApi({ '/leaderboard': { players: [{ name: 'Srv', ...stats(1, 1, 7) }] } }).api);
    expect(await lb.load(SERVER, 'miles')).toEqual(['1.  Srv   7 miles']);
  });

  it('otherwise mixes the world board with this device, this device winning', async () => {
    const { store } = makeStore();
    const world: WorldBoardTransport = { readAndUpdate: vi.fn(async () => ({ W: stats(1, 0, 9), Alex: stats(1, 0, 99) })) };
    const lb = new Leaderboard(store, fakeApi({}).api, world);
    lb.recordLocal('Alex', true, 20, 0);
    expect(await lb.load('', 'miles')).toEqual(['1.  Alex   20 miles', '2.  W   9 miles']);
  });

  it('submits only players on this device to the world board', () => {
    const { store } = makeStore();
    const world: WorldBoardTransport = { readAndUpdate: vi.fn(async () => ({})) };
    const lb = new Leaderboard(store, fakeApi({}).api, world);
    lb.recordLocal('Alex', true, 20, 0);
    lb.submitWorld(['Alex', 'Ghost', '']);
    expect(world.readAndUpdate).toHaveBeenCalledWith({ Alex: stats(1, 1, 20, 0, 0) });
    lb.submitWorld(['Ghost']);
    expect(world.readAndUpdate).toHaveBeenCalledTimes(1);
  });
});
