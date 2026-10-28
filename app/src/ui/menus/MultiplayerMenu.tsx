// Start Game in Multiplayer mode (docs/game-rules.md section 2): play online, or on this device with bots.
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { goOnline, startVsBots, startWatch } from './start';

export function MultiplayerMenu({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Start a game" onClose={onClose}>
      <div class="menu-list">
        <Button onClick={() => goOnline('quick')}>Quick online match</Button>
        <Button onClick={() => goOnline('host')}>Host a private room</Button>
        <Button onClick={() => goOnline('join')}>Join with a code</Button>
        <Button color="navy" onClick={startVsBots}>Play against bots on this device</Button>
        <Button color="navy" onClick={startWatch}>Watch bots play</Button>
        <Button color="plain" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
