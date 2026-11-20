// fitee "heat" palette, from the user's two brand sheets: Paper (light) and
// Molten (dark). Four plates run hot from amber to red; Ink / Chrome are the
// type colours. The same values are CSS variables in style.css, defined per
// theme; this file holds the ones drawn on canvas and in static icons.

/** Light theme ("Paper"). */
export const PAPER = {
  amber: '#F2A21A',
  orange: '#EC7518',
  flame: '#DD4A1B',
  red: '#B5241D',
  oxblood: '#7A1A16',
  paper: '#FFF9F4',
  ink: '#1E1412',
  bar: '#A8A099',
  collar: '#6B625B',
} as const;

/** Dark theme ("Molten"). */
export const MOLTEN = {
  amber: '#F7B23B',
  orange: '#F48A32',
  flame: '#EF6235',
  red: '#E5443A',
  crimson: '#C9303D',
  bronze: '#B08D57',
  chrome: '#D9DDE1',
  oxide: '#1B1D20',
  bar: '#9DA1A6',
} as const;

/**
 * Colours drawn over camera video and replays (always on black, whatever the
 * theme): the skeleton in amber, unreliable landmarks in red, and result
 * rings green for a passed check and red for a fault.
 */
export const ON_VIDEO = {
  bone: MOLTEN.amber,
  weak: MOLTEN.red,
  pass: '#6CCB94',
  fail: MOLTEN.red,
} as const;
