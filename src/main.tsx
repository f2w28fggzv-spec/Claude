// Must be the first import: blocks any request that would leave the device.
import './privacy';
import { render } from 'preact';
import './style.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);
