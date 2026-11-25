// Win rates between the bot levels, from games in the bots' own simulator (app/src/game/bots/sim.ts).
// Run from app/: npx vite-node ../tools/bot-arena.ts [games] [extraHardGames]
// Hard plays the learned strategy (learned.json); "start strategy" is where training began (close to the old Hard).
import { winRate } from '../app/src/game/bots/sim';
import { STARTING_STRATEGY } from '../app/src/game/bots/strategy';

const games = Number(process.argv[2] || 60);
const xGames = Number(process.argv[3] || 12);
const t0 = Date.now();
const pct = (x: number) => (x * 100).toFixed(0).padStart(3) + '%';
const line = async (label: string, p: Parameters<typeof winRate>[0], others: Parameters<typeof winRate>[1], n: number, seed: number, fair: string) =>
  console.log(label.padEnd(34), pct(await winRate(p, others, n, seed)), `(fair share ${fair})`);

await line('easy vs medium (1v1)', 'easy', ['medium'], games, 2000, '50%');
await line('medium vs hard (1v1)', 'medium', ['hard'], games, 3000, '50%');
await line('start strategy vs hard (1v1)', STARTING_STRATEGY, ['hard'], games, 4000, '50%');
await line('easy vs 2 medium', 'easy', ['medium', 'medium'], games, 5000, '33%');
await line('medium vs 2 hard', 'medium', ['hard', 'hard'], games, 6000, '33%');
await line('easy vs extra hard (1v1)', 'easy', ['insane'], xGames, 7000, '50%');
await line('hard vs extra hard (1v1)', 'hard', ['insane'], xGames, 8000, '50%');
console.log((Date.now() - t0) / 1000 + 's');
