import type { ComponentChildren, JSX } from 'preact';
import './components.css';

export type ButtonColor = 'red' | 'navy' | 'gold' | 'plain';

interface Props extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  color?: ButtonColor;
  children: ComponentChildren;
}

/** The game's rounded, outlined button. */
export function Button({ color = 'red', class: cls, children, ...rest }: Props) {
  return <button type="button" class={`btw-button btw-button--${color} ${cls ?? ''}`} {...rest}>{children}</button>;
}
