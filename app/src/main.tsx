import { render } from 'preact';
import { App } from './ui/app';
import './ui/theme.css';

render(<App />, document.getElementById('app')!);
