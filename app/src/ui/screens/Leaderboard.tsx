// Leaderboard: everyone (the game server's board, or the world board plus this device), or just this device.
import { useEffect, useState } from 'preact/hooks';
import { topTen, type BoardKind } from '../../services/leaderboard';
import { Page } from '../account/Page';
import { services } from '../services';

const KINDS: [BoardKind, string][] = [
  ['miles', 'Best miles'], ['rate', 'Win rate'], ['wins', 'Wins'], ['games', 'Games'], ['walls', 'Walls built'], ['spent', 'Supporters'],
];

type Source = 'everyone' | 'device';

export function LeaderboardScreen() {
  const [kind, setKind] = useState<BoardKind>('miles');
  const [source, setSource] = useState<Source>('everyone');
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    setLines(null);
    void (async () => {
      await services.init();
      const rows = source === 'device'
        ? topTen(Object.entries(services.leaderboard.local()).map(([name, r]) => ({ name, ...r })), kind)
        : await services.leaderboard.load(services.server(), kind);
      if (live) setLines(rows);
    })();
    return () => { live = false; };
  }, [kind, source]);

  return (
    <Page title="Leaderboard">
      <section class="btw-card">
        <div class="btw-tabs" role="group" aria-label="Whose scores">
          {(['everyone', 'device'] as Source[]).map(s => (
            <button key={s} type="button" class="btw-tab" aria-pressed={source === s} onClick={() => setSource(s)}>
              {s === 'everyone' ? 'Everyone' : 'This device'}
            </button>
          ))}
        </div>
        <div class="btw-tabs" role="group" aria-label="Which board" style={{ marginTop: '8px' }}>
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" class="btw-tab" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        {lines === null ? <p class="btw-muted">Loading...</p>
          : lines.length === 0 ? <p class="btw-muted">No scores yet. Play a game to get on the board!</p>
          : <ol class="btw-list">{lines.map(l => {
              const [, rank, name, value] = l.match(/^(\d+)\.\s+(.*?)\s{3}(.*)$/) ?? [];
              return <li key={l}><span><b>{rank}.</b> {name ?? l}</span><span>{value ?? ''}</span></li>;
            })}</ol>}
        {source === 'everyone' && !services.player.get().signedIn &&
          <p class="btw-muted">Sign in on the Account & Store screen to put your own scores on the world board.</p>}
      </section>
    </Page>
  );
}
