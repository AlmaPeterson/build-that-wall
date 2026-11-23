// "Your stats" on Account & Store. Everyone sees the totals; Gold members also see win rates by mode and
// bot level, their best game, favourite card, streaks and a chart of their last 20 games.
import { onCG } from '../platform';
import { cardById } from '../../data/cards';
import { loadLog, pct, summarize, type GameLine, type GameMode } from '../../services/stats/stats';
import { services } from '../services';
import { Button } from '../components/Button';
import { loadReplay, startReplay } from '../replay';

const MODE_NAMES: Record<GameMode, string> = { bots: 'Against bots', pass: "Pass'n'Play", online: 'Online', watch: 'Watching bots' };
const LEVEL_NAMES = { easy: 'Easy bots', medium: 'Medium bots', hard: 'Hard bots', insane: 'Insane bots' } as const;

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Miles in each of the last 20 games: one bar per game, a star over the ones you won. */
export function MilesChart({ games }: { games: GameLine[] }) {
  if (!games.length) return null;
  const W = 320, H = 120, top = 16, bottom = 18, gap = 2;
  const max = Math.max(10, ...games.map(g => g.miles));
  const slot = W / games.length, bar = Math.max(4, Math.min(18, slot - gap));
  const y = (m: number) => top + (H - top - bottom) * (1 - m / max);
  return (
    <figure class="stats__chart">
      <figcaption>Miles in your last {games.length} {games.length === 1 ? 'game' : 'games'} <span class="btw-muted">(★ = you won)</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Miles per game: ' + games.map(g => g.miles).join(', ')}>
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} class="stats__axis" />
        <text x="0" y="10" class="stats__tick">{max} mi</text>
        {games.map((g, i) => {
          const x = i * slot + (slot - bar) / 2, yy = y(g.miles), h = Math.max(1, H - bottom - yy);
          return (
            <g key={i} class="stats__bar">
              <title>{when(g.t)}: {g.miles} miles, {g.won ? 'won' : 'lost'} ({MODE_NAMES[g.mode]})</title>
              {/* a hit area as tall as the chart, so thin bars are easy to hover */}
              <rect x={i * slot} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              <path d={`M${x},${H - bottom} V${yy + Math.min(4, h)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 V${H - bottom} Z`} />
              {g.won && <text x={x + bar / 2} y={yy - 3} class="stats__star" text-anchor="middle">★</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function StatsCard({ gold }: { gold: boolean }) {
  const store = services.store;
  const games = +store.get('stat_games') || 0, wins = +store.get('stat_wins') || 0, best = +store.get('stat_best') || 0;
  const s = summarize(loadLog(store));
  return (
    <section class="btw-card" aria-labelledby="stats-h">
      <h2 id="stats-h">Your stats</h2>
      <div class="stats__tiles">
        <div><b>{games}</b><span>games</span></div>
        <div><b>{wins}</b><span>wins</span></div>
        <div><b>{games ? Math.round(100 * wins / games) + '%' : '-'}</b><span>won</span></div>
        <div><b>{best}</b><span>best miles</span></div>
      </div>
      {!gold && !onCG() && <p class="btw-muted">Gold members also see win rates by mode and bot level, their best game, favourite card, streaks and a chart of their games.</p>}
      {gold && (s.games === 0
        ? <p class="btw-muted">Play a game and your detailed stats show here.</p>
        : (
          <div class="stats__more">
            <MilesChart games={s.recent} />
            <table class="stats__table">
              <caption>Win rate</caption>
              <tbody>
                {(Object.keys(MODE_NAMES) as GameMode[]).filter(m => s.byMode[m]).map(m => (
                  <tr key={m}><th scope="row">{MODE_NAMES[m]}</th><td>{pct(s.byMode[m])}</td><td class="btw-muted">{s.byMode[m]!.wins} of {s.byMode[m]!.games}</td></tr>
                ))}
                {(Object.keys(LEVEL_NAMES) as (keyof typeof LEVEL_NAMES)[]).filter(l => s.byDiff[l]).map(l => (
                  <tr key={l}><th scope="row">{LEVEL_NAMES[l]}</th><td>{pct(s.byDiff[l])}</td><td class="btw-muted">{s.byDiff[l]!.wins} of {s.byDiff[l]!.games}</td></tr>
                ))}
              </tbody>
            </table>
            <ul class="stats__facts">
              {s.best && <li><b>Best game:</b> {s.best.miles} miles on {when(s.best.t)} ({MODE_NAMES[s.best.mode]}{s.best.won ? ', won' : ''})</li>}
              <li><b>Average:</b> {s.avgMiles} miles a game</li>
              {s.favourite && <li><b>Favourite card:</b> {cardById(s.favourite.card).name} (played {s.favourite.times} {s.favourite.times === 1 ? 'time' : 'times'})</li>}
              <li><b>Wins in a row:</b> {s.streak} now, {s.bestStreak} at best</li>
            </ul>
            {loadReplay() && <p><Button color="navy" onClick={() => { startReplay(); }}>Watch your last game again</Button></p>}
            <p class="btw-muted">From your last {s.games} {s.games === 1 ? 'game' : 'games'} on this account.</p>
          </div>
        ))}
    </section>
  );
}
