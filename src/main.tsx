// Must be the first import: blocks any request that would leave the device.
import './privacy';
import { render } from 'preact';
import './style.css';
import { App } from './app';

// Browsers with the View Transitions API animate navigation natively; the
// CSS fallback animation is only used without it.
if ('startViewTransition' in document) document.documentElement.classList.add('vt');

render(<App />, document.getElementById('app')!);
