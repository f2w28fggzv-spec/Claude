// Plain 2D geometry in pixel space (y grows downward, as on screen).
export interface Vec {
  x: number;
  y: number;
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle at `vertex` between rays to `a` and `c`, in degrees (0..180). */
export function angleDeg(a: Vec, vertex: Vec, c: Vec): number {
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = c.x - vertex.x;
  const v2y = c.y - vertex.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle of the hip→shoulder line from vertical, in degrees: 0 is upright,
 * 90 is horizontal, 180 is upside down. Direction (forward/back) is ignored.
 */
export function fromVerticalDeg(hip: Vec, shoulder: Vec): number {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // positive when the shoulder is above the hip
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}
