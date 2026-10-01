import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, safeRelativePath, sha256, compareVersions } from '../src/shared.js';

test('canonical JSON is key-order independent and deterministic', () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(canonical([1, { y: null, x: true }]), '[1,{"x":true,"y":null}]');
  assert.throws(() => canonical({ missing: undefined }));
});

test('cross-platform path policy refuses traversal and special files', () => {
  for (const path of ['../secret','a/../secret','/etc/passwd','C:/file','a\\b','a//b','a/./b','a/','a\u0000b','CON.txt','a/aux','file.','file ']) assert.equal(safeRelativePath(path), false, path);
  for (const path of ['SKILL.md','references/checks.md','assets/template.json']) assert.equal(safeRelativePath(path), true, path);
});

test('sha256 and version comparison behave deterministically', () => {
  assert.equal(sha256('abc'), sha256(Buffer.from('abc')));
  assert.equal(compareVersions('1.2.3', '1.2.10'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});
