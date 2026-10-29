import { describe, expect, it } from 'vitest';
import { iqr, median, newcombe, quantile, verdict, wilson } from '../src/stats.js';

describe('published statistics', () => {
  it('matches reference Wilson score intervals', () => {
    const [low, high] = wilson(8, 10)!;
    expect(low).toBeCloseTo(0.4902, 4);
    expect(high).toBeCloseTo(0.9433, 4);
    expect(wilson(0, 10)![0]).toBe(0);
    expect(wilson(10, 10)![1]).toBe(1);
    expect(wilson(0, 0)).toBeNull();
    expect(() => wilson(11, 10)).toThrow(RangeError);
  });

  it('matches Newcombe (1998) worked example for a difference of proportions', () => {
    // Newcombe 1998, Table II example (a): 56/70 vs 48/80 → −… method 10 interval 0.0524 to 0.3339.
    const [low, high] = newcombe(56, 70, 48, 80)!;
    expect(low).toBeCloseTo(0.0524, 3);
    expect(high).toBeCloseTo(0.3339, 3);
    expect(verdict([low, high])).toBe('improves');
  });

  it('only claims a direction when the interval excludes zero', () => {
    expect(verdict([-0.1, 0.4])).toBe('no-detectable-difference');
    expect(verdict([-0.5, -0.01])).toBe('hurts');
    expect(verdict(newcombe(4, 5, 3, 5))).toBe('no-detectable-difference');
    expect(verdict(null)).toBeNull();
  });

  it('uses linear-interpolation quantiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
    expect(iqr([1, 2, 3, 4, 5])).toEqual([2, 4]);
  });
});
