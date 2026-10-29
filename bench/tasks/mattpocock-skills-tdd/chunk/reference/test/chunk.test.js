import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from '../src/chunk.js';

test('chunk splits into groups and rejects bad sizes', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => chunk([1], 0), RangeError);
});
