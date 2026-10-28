// Placeholder: replaced in Phase 2.
import { screen } from '../app-state';
import { Button } from '../components/Button';

export function LeaderboardScreen() {
  return (
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h1>Leaderboard</h1>
      <Button onClick={() => screen.set('menu')}>Back</Button>
    </div>
  );
}
