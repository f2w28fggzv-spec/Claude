// fitee logo: a barbell with four plates (red, blue | yellow, green) on a
// grey bar, and the wordmark in Bricolage Grotesque ExtraBold. The same mark
// is drawn in public/favicon.svg and the app icons.
import { INK, PLATE } from './brand';

const BAR = '#A2A7AF';
const COLLAR = '#6E737B';

/** The barbell mark on its own (twice as wide as it is tall). */
export function LogoMark({ height = 24 }: { height?: number }) {
  return (
    <svg class="logo-mark" viewBox="0 0 64 32" width={height * 2} height={height} aria-hidden="true">
      <rect x={1} y={14.5} width={62} height={3} rx={1.5} fill={BAR} />
      <rect x={9} y={7} width={5.5} height={18} rx={1.6} fill={PLATE.red} />
      <rect x={15.5} y={3} width={5.5} height={26} rx={1.6} fill={PLATE.blue} />
      <rect x={22} y={11.5} width={2.5} height={9} rx={1} fill={COLLAR} />
      <rect x={39.5} y={11.5} width={2.5} height={9} rx={1} fill={COLLAR} />
      <rect x={43} y={3} width={5.5} height={26} rx={1.6} fill={PLATE.yellow} />
      <rect x={49.5} y={7} width={5.5} height={18} rx={1.6} fill={PLATE.green} />
    </svg>
  );
}

/** Mark + wordmark. `height` is the mark's height; the wordmark scales with it. */
export function Logo({ height = 24, stacked = false }: { height?: number; stacked?: boolean }) {
  return (
    <span class={`logo ${stacked ? 'stacked' : ''}`} role="img" aria-label="fitee" style={{ '--logo-h': `${height}px`, color: INK }}>
      <LogoMark height={height} />
      <span class="wordmark" aria-hidden="true">
        fitee
      </span>
    </span>
  );
}
