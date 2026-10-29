// Small, dependency-free statistics used for every published number. The
// website imports this module too, and the data validator recomputes each
// interval from k/n, so a published figure always matches its counts.

export type Interval = [number, number];

const Z95 = 1.959963984540054;

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = Z95): Interval | null {
  if (n <= 0) return null;
  if (k < 0 || k > n) throw new RangeError(`invalid count ${k}/${n}`);
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denominator = 1 + z2 / n;
  // The bounds are exactly 0 or 1 at the extremes; avoid 0.9999999999999999.
  const lower = k === 0 ? 0 : Math.max(0, (centre - margin) / denominator);
  const upper = k === n ? 1 : Math.min(1, (centre + margin) / denominator);
  return [lower, upper];
}

/**
 * Newcombe hybrid score interval for the difference p1 − p2 of two
 * independent proportions (Newcombe 1998, method 10).
 */
export function newcombe(k1: number, n1: number, k2: number, n2: number, z = Z95): Interval | null {
  const a = wilson(k1, n1, z);
  const b = wilson(k2, n2, z);
  if (!a || !b) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const delta = p1 - p2;
  const lower = delta - Math.sqrt((p1 - a[0]) ** 2 + (b[1] - p2) ** 2);
  const upper = delta + Math.sqrt((a[1] - p1) ** 2 + (p2 - b[0]) ** 2);
  return [Math.max(-1, lower), Math.min(1, upper)];
}

/** Linear-interpolation quantile (R type 7, the spreadsheet default). */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function iqr(values: number[]): Interval | null {
  const low = quantile(values, 0.25);
  const high = quantile(values, 0.75);
  return low === null || high === null ? null : [low, high];
}

export type Verdict = 'improves' | 'hurts' | 'no-detectable-difference';

/** Methodology v1: a direction is claimed only when the 95% interval excludes zero. */
export function verdict(interval: Interval | null): Verdict | null {
  if (!interval) return null;
  if (interval[0] > 0) return 'improves';
  if (interval[1] < 0) return 'hurts';
  return 'no-detectable-difference';
}

/** Rounds for storage so recomputation compares equal across platforms. */
export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundInterval(interval: Interval | null, digits = 4): Interval | null {
  return interval ? [round(interval[0], digits), round(interval[1], digits)] : null;
}
