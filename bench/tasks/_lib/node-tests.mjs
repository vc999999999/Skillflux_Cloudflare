// Grading helpers for the JavaScript tasks: hidden tests run against the
// workspace's module, and the project's own tests must exist and pass.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, run } from './grade-lib.mjs';

/** Runs `body` as a node:test file that can import `module` (a path inside workDir). */
export function hiddenTests(workDir, module, body) {
  const dir = mkdtempSync(join(tmpdir(), 'skillflux-hidden-'));
  try {
    const file = join(dir, 'hidden.test.mjs');
    writeFileSync(file, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nconst mod = await import(${JSON.stringify(pathToFileURL(join(workDir, module)).href)});\n${body}\n`);
    const result = run(dir, process.execPath, ['--test', file]);
    const summary = result.output.match(/# (?:pass|fail) \d+/g)?.join(', ') ?? '';
    return check('hidden-tests', result.ok, result.ok ? `hidden tests pass (${summary})` : `hidden tests fail: ${summary || result.output.slice(-200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, root, out);
    else out.push(relative(root, path));
  }
  return out;
}

/** The project must contain a test that names the function, and `npm test` must pass. */
export function ownTests(workDir, functionName) {
  const tests = walk(workDir).filter(path => /(^|\/)(test|tests|__tests__)\/.*\.[cm]?js$|\.test\.[cm]?js$|\.spec\.[cm]?js$/.test(path))
    .filter(path => readFileSync(join(workDir, path), 'utf8').includes(functionName));
  if (!tests.length) return check('own-tests', false, `no test file mentions ${functionName}`);
  const result = run(workDir, 'npm', ['test', '--silent']);
  return check('own-tests', result.ok, result.ok ? `npm test passes (${tests.join(', ')})` : `npm test fails: ${result.output.slice(-200)}`);
}

export { execFileSync };
