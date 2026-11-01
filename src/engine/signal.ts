// Small numeric helpers for landmark time series.

export function percentile(values: number[], p: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, (v.length - 1) * p));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

export const median = (values: number[]) => percentile(values, 0.5);

/**
 * Fills gaps (NaN) by linear interpolation when they last at most maxGapMs.
 * Longer gaps stay NaN.
 */
export function fillGaps(values: number[], times: number[], maxGapMs: number): number[] {
  const out = values.slice();
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (last >= 0 && i - last > 1 && times[i] - times[last] <= maxGapMs) {
      for (let k = last + 1; k < i; k++) {
        const f = (times[k] - times[last]) / (times[i] - times[last]);
        out[k] = out[last] + (out[i] - out[last]) * f;
      }
    }
    last = i;
  }
  return out;
}

/** Centered moving average over a time window; NaN entries are skipped. */
export function smooth(values: number[], times: number[], windowMs: number): number[] {
  const half = windowMs / 2;
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return NaN;
    let sum = 0;
    let n = 0;
    for (let k = i; k >= 0 && times[i] - times[k] <= half; k--) {
      if (Number.isFinite(values[k])) {
        sum += values[k];
        n++;
      }
    }
    for (let k = i + 1; k < values.length && times[k] - times[i] <= half; k++) {
      if (Number.isFinite(values[k])) {
        sum += values[k];
        n++;
      }
    }
    return sum / n;
  });
}
