// Plays whole bot games and checks every animation step against the card-animation rules:
// a card never appears, vanishes or jumps, is never in two places, and a card everyone can see
// never flies face down.
import { describe, expect, it } from 'vitest';
import { CARD_BACK, createLocalGame, type Difficulty, DEFAULT_SETTINGS, redactEvent, viewFor, type GameEvent, type GameState } from '../../game';
import type { GameSnapshot } from '../controller';
import { planStep, type Held } from './animator';
import { key, type Move, type Place } from './moves';

/** Every snapshot the board would get in one game, as seen by seat 0 (a person, or watching bots). */
async function snapshots(seed: number, watch: boolean): Promise<GameSnapshot[]> {
  const players = 2 + (seed % 5);
  const out: GameSnapshot[] = [];
  const events: GameEvent[] = [];
  const game = createLocalGame({
    settings: { ...DEFAULT_SETTINGS, players, bots: players, difficulties: ['medium', 'hard', 'easy', 'medium', 'hard', 'easy'].slice(0, players) as Difficulty[] },
    seed, learn: false, strictCards: true,
    emit: e => {
      events.push(e);
      const view = viewFor(game.state as GameState, 0, watch);
      if (!watch) view.seats[0]!.bot = null;          // seat 0 plays like a bot but is shown as a person
      out.push({ view, viewer: 0, events: watch ? [...events] : events.map(x => redactEvent(x, 0)), prompt: null, passTo: null, openHands: watch });
    },
  });
  await game.start();
  return out;
}

const zone = (p: Place) => (p.at === 'walls' || p.at === 'guard' ? key(p) + ':' + p.kind : key(p));

function zones(v: GameState): Map<string, number> {
  const m = new Map<string, number>();
  const add = (k: string, n = 1) => { if (n) m.set(k, (m.get(k) ?? 0) + n); };
  v.seats.forEach((s, seat) => {
    add('hand' + seat, s.hand.length);
    s.walls.forEach(w => add('walls' + seat + ':' + w));
    if (s.limitNext > 0) add('limit' + seat);
    if ((s.quarantine ?? 0) > 0) add('skip' + seat);
  });
  v.trainGuards.forEach(g => add('guard:' + g.kind));
  add('draw', v.draw.length); add('discard', v.discard.length); add('jail', v.jail.length);
  return m;
}

/** Board places everyone can see a card in. */
function isPublic(p: Place, viewer: number, watch: boolean): boolean {
  return p.at === 'discard' || p.at === 'walls' || p.at === 'jail' || p.at === 'guard' || p.at === 'limit' || p.at === 'skip'
    || (p.at === 'hand' && (watch || p.seat === viewer));
}

interface Problem { seed: number; step: number; kind: string; detail: string; events: string }

function audit(snaps: GameSnapshot[], seed: number, watch: boolean): Problem[] {
  const problems: Problem[] = [];
  let shown = snaps[0]!;
  let held: Held | null = null;
  snaps.slice(1).forEach((next, i) => {
    const prev = shown;
    const fresh = next.events.slice(prev.events.length);
    const say = (kind: string, detail: string) => problems.push({ seed, step: i, kind, detail, events: fresh.map(e => e.type + ':' + e.text).join(' | ') });
    const heldIn = held;
    const plan = planStep(prev, next, 1, undefined, held);
    shown = next;
    if (!plan) {
      // Nothing flies: the board just changes. Anything that changed place teleported.
      const a = zones(prev.view!), b = zones(next.view!);
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        if ((a.get(k) ?? 0) !== (b.get(k) ?? 0) && k !== 'draw') say('teleport (no animation)', k + ' ' + (a.get(k) ?? 0) + '→' + (b.get(k) ?? 0));
      }
      held = null;
      return;
    }
    held = plan.held;
    const before = zones(prev.view!), mid = zones(plan.mid), after = zones(next.view!);
    const froms = new Map<string, number>(), tos = new Map<string, number>();
    for (const m of plan.moves) {
      froms.set(zone(m.from), (froms.get(zone(m.from)) ?? 0) + 1);
      tos.set(zone(m.to), (tos.get(zone(m.to)) ?? 0) + 1);
    }
    for (const k of new Set([...before.keys(), ...after.keys(), ...mid.keys()])) {
      const b = before.get(k) ?? 0, md = mid.get(k) ?? 0, a = after.get(k) ?? 0;
      if (b - md !== (froms.get(k) ?? 0)) say('leaves without flying (or doubled)', `${k}: before ${b}, while flying ${md}, flights out ${froms.get(k) ?? 0}`);
      if (a - md !== (tos.get(k) ?? 0) && k !== 'draw') say('appears without flying', `${k}: while flying ${md}, after ${a}, flights in ${tos.get(k) ?? 0}`);
    }
    for (const m of plan.moves) {
      if (m.card === CARD_BACK && m.from.at !== 'draw' && (isPublic(m.from, 0, watch) || isPublic(m.to, 0, watch))) say('face down but public', `${zone(m.from)} → ${zone(m.to)}`);
      if ((m.from.at === 'center' || m.from.at === 'seat') && m.card !== heldIn?.card && !fresh.some(e => e.type === 'play' || e.type === 'immediate')) say('from nowhere', `${zone(m.from)} → ${zone(m.to)}`);
    }
    for (const f of plan.flights) {
      for (let k = 1; k < f.keys.length; k++) {
        const p = f.keys[k - 1]!, q = f.keys[k]!;
        if (q.t - p.t < 1 && (Math.abs(q.x - p.x) > 1 || Math.abs(q.y - p.y) > 1)) say('jumps mid-flight', `card ${f.card} at ${p.t}ms`);
      }
    }
  });
  return problems;
}

async function report(watch: boolean, seeds: number[]) {
  const all: Problem[] = [];
  for (const seed of seeds) all.push(...audit(await snapshots(seed, watch), seed, watch));
  const byKind = new Map<string, Problem[]>();
  for (const p of all) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const lines = [...byKind].map(([k, ps]) => `${ps.length} × ${k}\n` + ps.slice(0, 4).map(p => `    seed ${p.seed} step ${p.step}: ${p.detail}\n      ${p.events.slice(0, 300)}`).join('\n'));
  console.log((watch ? 'WATCH' : 'PERSON') + ' MODE\n' + lines.join('\n'));
  if (process.env.AUDIT_GROUP) {
    const g = new Map<string, number>();
    for (const p of all) { const k = p.kind + ' | ' + p.events.split(' | ').map(x => x.split(':')[0]).join('+') + ' | ' + (p.detail.split(':')[0] ?? '').replace(/[0-9]/g, ''); g.set(k, (g.get(k) ?? 0) + 1); }
    console.log([...g].sort((a, b) => b[1] - a[1]).map(([k, n]) => n + '  ' + k).join('\n'));
  }
  return all;
}

describe('card animations over whole games', () => {
  const seeds = Array.from({ length: Number(process.env.AUDIT_GAMES ?? 15) }, (_, i) => i + 1);
  it('a person playing with bots', async () => { expect((await report(false, seeds)).length).toBe(0); }, 60000);
  it('watching bots', async () => { expect((await report(true, seeds)).length).toBe(0); }, 60000);
});
