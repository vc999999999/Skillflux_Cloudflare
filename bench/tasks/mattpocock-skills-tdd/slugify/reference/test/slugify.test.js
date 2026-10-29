import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('slugify lowercases and joins words with hyphens', () => {
  assert.equal(slugify('  Hello, World! '), 'hello-world');
  assert.equal(slugify('Version 2.0 Release'), 'version-2-0-release');
});
