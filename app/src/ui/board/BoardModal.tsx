// The box over the board that confirms ending the game.
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { Button } from '../components/Button';
import { RESIZE_TITLE, useDraggable } from '../components/drag';

function BoardModal({ title, onClose, children }: { title: string; onClose(): void; children: ComponentChildren }) {
  const drag = useDraggable('board-modal');
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class={'board-modal' + (drag.moved ? ' board-modal--moved' : '')} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="board-modal__box drag-box" ref={drag.ref} style={drag.style} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <span class="drag-grip" title={RESIZE_TITLE} aria-hidden="true" />
      </div>
    </div>
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
