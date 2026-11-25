// Must be the first import: blocks any request that would leave the device.
import './privacy';
import { render } from 'preact';
// Bricolage Grotesque, bundled and served from this site (no font CDN).
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './style.css';
import { App } from './app';
import { startOffline } from './offline/client';
import { applyTheme } from './theme';

// Light or dark as chosen in Settings (default: follow the phone).
applyTheme();

// Browsers with the View Transitions API animate navigation natively; the
// CSS fallback animation is only used without it.
if ('startViewTransition' in document) document.documentElement.classList.add('vt');

render(<App />, document.getElementById('app')!);

// Install and offline use: the service worker (production builds only).
startOffline();
