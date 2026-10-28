// Small boxes over the board: the Build Wall menu and the End Game confirmation.
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { Button } from '../components/Button';
import type { BuildOption, CardChoice } from './board-state';

function BoardModal({ title, onClose, children }: { title: string; onClose(): void; children: ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="board-modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="board-modal__box" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function BuildMenu({ options, onChoose, onClose }: { options: BuildOption[]; onChoose(c: CardChoice): void; onClose(): void }) {
  return (
    <BoardModal title="Build a Wall" onClose={onClose}>
      {options.length
        ? <div class="board-modal__list">{options.map(o => <Button key={o.label} onClick={() => onChoose(o.choice)}>{o.label}</Button>)}</div>
        : <p>You can't build right now. You need a Wall Section and a Man Hour, or 3 Wall Sections, and an action left.</p>}
      <Button color="plain" onClick={onClose}>Back</Button>
    </BoardModal>
  );
}

export function ConfirmEnd({ onYes, onNo }: { onYes(): void; onNo(): void }) {
  return (
    <BoardModal title="End this game?" onClose={onNo}>
      <p>The game will stop and you'll go back to the menu.</p>
      <div class="board-modal__row">
        <Button onClick={onYes}>End Game</Button>
        <Button color="plain" onClick={onNo}>Keep Playing</Button>
      </div>
    </BoardModal>
  );
}
