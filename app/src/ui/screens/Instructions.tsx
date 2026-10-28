// Placeholder: replaced in Phase 2.
import { screen } from '../app-state';
import { Button } from '../components/Button';

export function InstructionsScreen() {
  return (
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h1>Instructions</h1>
      <Button onClick={() => screen.set('menu')}>Back</Button>
    </div>
  );
}
