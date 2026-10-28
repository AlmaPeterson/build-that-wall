import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import './components.css';

interface Props {
  title?: string;
  /** Called by Escape and the backdrop. Leave out for a modal the player must answer. */
  onClose?: () => void;
  children: ComponentChildren;
}

/** A centred box over a dark backdrop. */
export function Modal({ title, onClose, children }: Props) {
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="btw-modal" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div class="btw-modal__box" role="dialog" aria-modal="true" aria-label={title}>
        {title && <h2 class="btw-modal__title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
