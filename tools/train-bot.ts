// Trains the bot strategy (app/src/game/bots/strategy.ts) by playing games in the bots' own simulator, with no
// people playing or watching. Hill climbing: change a few numbers, play the changed strategy against Medium, Hard
// and the current best on the same deals, and keep the change only if it wins more. Writes the best strategy found
// to the file given (JSON).
// Run from app/: npx vite-node ../tools/train-bot.ts <minutes> <seed> <out.json> [start.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { winRate, type SimPlayer } from '../app/src/game/bots/sim';
import { STARTING_STRATEGY, fromVector, toVector, type Strategy } from '../app/src/game/bots/strategy';

const [minutes = '10', seedArg = '1', out = 'learned.json', startFile] = process.argv.slice(2);
let rnd = Number(seedArg) * 7919 + 13;
const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

/** How good a strategy is: win shares against Medium and Hard (3 players and 1 on 1) and against `rival`. */
async function fitness(w: Strategy, rival: SimPlayer, seed0: number): Promise<number> {
  const a = await winRate(w, ['medium', 'hard'], 36, seed0);          // fair share 1/3
  const b = await winRate(w, ['hard'], 24, seed0 + 100);              // 1/2
  const c = await winRate(w, ['medium'], 24, seed0 + 200);            // 1/2
  const d = await winRate(w, [rival], 24, seed0 + 300);               // 1/2
  return (a * 3 + b * 2 + c * 2 + d * 2) / 4;                         // about 1 = an even share everywhere
}

let best: Strategy = startFile ? JSON.parse(readFileSync(startFile, 'utf8')) : STARTING_STRATEGY;
let seed0 = Number(seedArg) * 100000;
let bestFit = await fitness(best, 'hard', seed0);
console.log('start', bestFit.toFixed(3));
const end = Date.now() + Number(minutes) * 60000;
let round = 0;
while (Date.now() < end) {
  round++;
  const v = toVector(best);
  const n = 1 + Math.floor(random() * 3);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(random() * v.length);
    v[i] = v[i]! + gauss() * (Math.abs(v[i]!) * 0.35 + 0.6);
  }
  const cand = fromVector(v);
  // Same deals for both: the change, not the luck of the cards, decides
  const f = await fitness(cand, best, seed0);
  const fBest = await fitness(best, best, seed0);
  if (f > fBest + 0.02) {
    best = cand; bestFit = f;
    writeFileSync(out, JSON.stringify(best, null, 1));
    console.log('round', round, 'better', f.toFixed(3), 'vs', fBest.toFixed(3));
  }
  if (round % 6 === 0) seed0 += 1000;   // new deals now and then, so it doesn't learn one set of games by heart
}
writeFileSync(out, JSON.stringify(best, null, 1));
console.log('done', round, 'rounds; best', bestFit.toFixed(3));
