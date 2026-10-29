import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';

test('parseDuration adds hours and minutes', () => {
  assert.equal(parseDuration('1h30m'), 90);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('45m'), 45);
});
