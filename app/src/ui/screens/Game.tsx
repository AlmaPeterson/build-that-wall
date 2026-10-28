// Placeholder: replaced in Phase 2.
import { screen } from '../app-state';
import { Button } from '../components/Button';

export function GameScreen() {
  return (
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h1>Game</h1>
      <Button onClick={() => screen.set('menu')}>Back</Button>
    </div>
  );
}
