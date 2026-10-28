import type { ComponentChildren } from 'preact';
import { screen } from '../app-state';
import { Button } from '../components/Button';
import './pages.css';

/** A screen with the red header and a Back button to the menu. */
export function Page({ title, onBack, children }: { title: string; onBack?: () => void; children: ComponentChildren }) {
  return (
    <div class="btw-page">
      <header class="btw-page__head">
        <Button color="navy" onClick={onBack ?? (() => screen.set('menu'))}>Back</Button>
        <h1>{title}</h1>
        <span class="btw-page__spacer" />
      </header>
      <main class="btw-page__body">{children}</main>
    </div>
  );
}

/** A message under an action: gold for good news, red for problems. */
export function Message({ text, ok }: { text: string; ok: boolean }) {
  if (!text) return null;
  return <p class={`btw-msg ${ok ? 'btw-msg--ok' : 'btw-msg--bad'}`} role="status">{text}</p>;
}
