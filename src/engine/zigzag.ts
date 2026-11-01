// Turning-point detector with hysteresis. Works incrementally, so the same
// code counts reps live and segments a finished recording.
//
// Values are screen y (down is positive): a 'top' is a local minimum of y,
// a 'bottom' a local maximum. A turning point is confirmed once the signal
// has moved back from it by at least `h`, which ignores jitter and small
// bounces.

export type ExtremeType = 'top' | 'bottom';

export interface Extreme {
  index: number;
  value: number;
  type: ExtremeType;
}

export class Zigzag {
  readonly extremes: Extreme[] = [];
  /** 0: not moved yet; 1: heading down (candidate bottom); -1: heading up. */
  private dir: 0 | 1 | -1 = 0;
  private min = { v: Infinity, i: -1 };
  private max = { v: -Infinity, i: -1 };
  private cand = { v: NaN, i: -1 };

  constructor(public h: number) {}

  /** Current unconfirmed turning point, if the signal has started moving. */
  candidate(): Extreme | null {
    if (this.dir === 0) return null;
    return { index: this.cand.i, value: this.cand.v, type: this.dir === 1 ? 'bottom' : 'top' };
  }

  /**
   * Adds a sample. Returns the turning point it confirmed, if any.
   * NaN samples are skipped.
   */
  push(i: number, v: number): Extreme | null {
    if (!Number.isFinite(v)) return null;
    if (this.dir === 0) {
      if (v < this.min.v) this.min = { v, i };
      if (v > this.max.v) this.max = { v, i };
      if (v - this.min.v >= this.h) return this.turn({ index: this.min.i, value: this.min.v, type: 'top' }, 1, v, i);
      if (this.max.v - v >= this.h) return this.turn({ index: this.max.i, value: this.max.v, type: 'bottom' }, -1, v, i);
      return null;
    }
    if (this.dir === 1) {
      if (v > this.cand.v) this.cand = { v, i };
      else if (this.cand.v - v >= this.h)
        return this.turn({ index: this.cand.i, value: this.cand.v, type: 'bottom' }, -1, v, i);
    } else {
      if (v < this.cand.v) this.cand = { v, i };
      else if (v - this.cand.v >= this.h)
        return this.turn({ index: this.cand.i, value: this.cand.v, type: 'top' }, 1, v, i);
    }
    return null;
  }

  /** Ends the signal: the last candidate counts as a turning point too. */
  finish(): Extreme[] {
    const c = this.candidate();
    if (c && c.index !== this.extremes[this.extremes.length - 1]?.index) this.extremes.push(c);
    this.dir = 0;
    return this.extremes;
  }

  private turn(e: Extreme, dir: 1 | -1, v: number, i: number): Extreme {
    this.extremes.push(e);
    this.dir = dir;
    this.cand = { v, i };
    return e;
  }
}
