// fitee logo: four plates side by side (amber, orange, flame, red) between
// two collars on a bar, and the wordmark in Bricolage Grotesque ExtraBold.
// Colours come from CSS (`.lm-*`, `.wm-*`), so the mark follows the theme.
// public/favicon.svg and the app icons draw the same mark.

/** The barbell mark on its own (1.28 × as wide as it is tall). */
export function LogoMark({ height = 24 }: { height?: number }) {
  return (
    <svg class="logo-mark" viewBox="0 0 128 100" width={height * 1.28} height={height} aria-hidden="true">
      <rect class="lm-bar" x={0} y={45.5} width={128} height={9} rx={4.5} />
      <rect class="lm-collar" x={2} y={28} width={8} height={44} rx={2} />
      <rect class="lm-p1" x={14} y={0} width={14} height={100} rx={7} />
      <rect class="lm-p2" x={31} y={0} width={14} height={100} rx={7} />
      <rect class="lm-p3" x={48} y={0} width={14} height={100} rx={7} />
      <rect class="lm-p4" x={65} y={0} width={14} height={100} rx={7} />
      <rect class="lm-collar" x={83} y={28} width={8} height={44} rx={2} />
    </svg>
  );
}

/**
 * Mark + wordmark. `height` is the mark's height; the wordmark scales with it.
 * `heat` colours each letter from amber to red, like the brand sheet's hero.
 */
export function Logo({ height = 24, heat = false, mark = true }: { height?: number; heat?: boolean; mark?: boolean }) {
  return (
    <span class={`logo ${heat ? 'heat' : ''}`} role="img" aria-label="fitee" style={{ '--logo-h': `${height}px` }}>
      {mark && <LogoMark height={height} />}
      <span class="wordmark" aria-hidden="true">
        {heat ? ['f', 'i', 't', 'e', 'e'].map((c, i) => <span class={`wm-${i + 1}`}>{c}</span>) : 'fitee'}
      </span>
    </span>
  );
}
