import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureCatalog } from './runtime-fixture.js';
import { installBootstrapSkill } from '../src/runtime/bootstrap.js';

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', code => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

async function runJson(args: string[]): Promise<Record<string, any>> {
  const result = await runCli(args);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('CLI init defaults to manual, accepts opt-in and preserves it on repeated init', async t => {
  const fixture = await fixtureCatalog(t);
  const project = join(fixture.project, 'fresh');
  await mkdir(project);
  const initArgs = ['init', '--project', project, '--repo', fixture.repo, '--source', fixture.origin, '--host', 'generic'];
  assert.equal((await runJson(initArgs)).updatePolicy, 'manual');
  assert.equal((await runJson([...initArgs, '--update-policy', 'follow-compatible'])).updatePolicy, 'follow-compatible');
  assert.equal((await runJson(initArgs)).updatePolicy, 'follow-compatible');
  const policy = JSON.parse(await readFile(join(project, '.skillflux', 'policy.json'), 'utf8'));
  assert.equal(policy.preauthorizeReviewedText, false, 'update opt-in must not grant first-install permission');
  assert.equal((await runJson([...initArgs, '--update-policy', 'manual'])).updatePolicy, 'manual');
});

test('CLI update-policy reads without rewriting and enables or disables following', async t => {
  const fixture = await fixtureCatalog(t);
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const before = await readFile(policyPath, 'utf8');
  assert.deepEqual(await runJson(['update-policy', '--project', fixture.project]), { mode: 'manual' });
  assert.equal(await readFile(policyPath, 'utf8'), before);
  assert.deepEqual(await runJson(['update-policy', 'follow-compatible', '--project', fixture.project]), { mode: 'follow-compatible' });
  assert.deepEqual(await runJson(['update-policy', '--project', fixture.project]), { mode: 'follow-compatible' });
  assert.deepEqual(await runJson(['update-policy', 'manual', '--project', fixture.project]), { mode: 'manual' });
});

test('CLI rejects invalid update policies without changing project policy', async t => {
  const fixture = await fixtureCatalog(t);
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const before = await readFile(policyPath, 'utf8');
  for (const args of [
    ['update-policy', 'always'],
    ['update-policy', 'manual', 'follow-compatible'],
    ['init', '--update-policy', 'always'],
  ]) {
    const result = await runCli([...args, '--project', fixture.project]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INVALID_UPDATE_POLICY|INVALID_ARGUMENTS/);
    assert.equal(await readFile(policyPath, 'utf8'), before);
  }
});

test('CLI follow opt-in upgrades on load without enabling install preauthorization', async t => {
  const fixture = await fixtureCatalog(t);
  const projectArgs = ['--project', fixture.project];
  await runJson(['install', 'code-review@1.0.0', ...projectArgs]);
  await runJson(['update-policy', 'follow-compatible', ...projectArgs]);
  fixture.add('1.1.0');
  const loaded = await runJson(['load', 'code-review', ...projectArgs]);
  assert.equal(loaded.manifest.version, '1.1.0');
  assert.match(loaded.entry.content, /Synthetic test fixture version 1\.1\.0/);
  const policy = JSON.parse(await readFile(join(fixture.project, '.skillflux', 'policy.json'), 'utf8'));
  assert.equal(policy.preauthorizeReviewedText, false);
  await runJson(['update-policy', 'manual', ...projectArgs]);
  fixture.add('1.2.0');
  assert.equal((await runJson(['load', 'code-review', ...projectArgs])).manifest.version, '1.1.0');
});

test('bootstrap upgrades managed entry generations and preserves unmarked user files', async t => {
  const fixture = await fixtureCatalog(t);
  const target = await installBootstrapSkill(fixture.project, 'generic');
  for (const generation of [1, 2, 3]) {
    await writeFile(target, `---\nname: skillflux\n---\n\n<!-- skillflux-bootstrap:v${generation} -->\n\nOlder managed entry.\n`);
    assert.equal(await installBootstrapSkill(fixture.project, 'generic'), target);
    const upgraded = await readFile(target, 'utf8');
    assert.match(upgraded, /<!-- skillflux-bootstrap:v3 -->/);
    assert.match(upgraded, /follow-compatible/);
    assert.doesNotMatch(upgraded, /Older managed entry/);
  }
  const custom = '---\nname: skillflux\n---\n\nMy own project instructions.\n';
  await writeFile(target, custom);
  await assert.rejects(installBootstrapSkill(fixture.project, 'generic'), { code: 'BOOTSTRAP_CONFLICT' });
  assert.equal(await readFile(target, 'utf8'), custom);
});

test('bootstrap preserves explicit invocation requirements after a managed upgrade', async t => {
  const fixture = await fixtureCatalog(t);
  for (const host of ['claude', 'cursor'] as const) {
    const target = await installBootstrapSkill(fixture.project, host);
    await installBootstrapSkill(fixture.project, host);
    const content = await readFile(target, 'utf8');
    assert.match(content, /^disable-model-invocation: true$/m);
    assert.match(content, /^user-invocable: true$/m);
    assert.match(content, /<!-- skillflux-bootstrap:v3 -->/);
  }
});
