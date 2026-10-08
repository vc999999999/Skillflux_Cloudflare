import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureCatalog } from './runtime-fixture.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

async function installedFixture(t: TestContext) {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(plan.id, 'cli');
  return { fixture, runtime };
}

async function lockContents(project: string): Promise<string> {
  return readFile(join(project, '.skillflux', 'lock.json'), 'utf8');
}

test('legacy projects default to manual updates and leave the installed lock unchanged', async t => {
  const { fixture, runtime } = await installedFixture(t);
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  delete policy.updatePolicy;
  await writeFile(policyPath, JSON.stringify(policy));
  fixture.add('1.1.0');
  const before = await lockContents(fixture.project);

  assert.deepEqual(await runtime.getUpdatePolicy(), { mode: 'manual' });
  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.mode, 'manual');
  assert.equal(loaded.autoUpdate?.status, 'manual');
  assert.equal(await lockContents(fixture.project), before);
});

test('follow policy persists and returns the new skill and resources during the same load', async t => {
  const { fixture, runtime } = await installedFixture(t);
  assert.deepEqual(await runtime.setUpdatePolicy('follow-compatible'), { mode: 'follow-compatible' });
  const reopened = await SkillFluxRuntime.open(fixture.project);
  assert.deepEqual(await reopened.getUpdatePolicy(), { mode: 'follow-compatible' });
  const release = fixture.add('1.1.0');
  release.files['references/checklist.md'] = 'The new release checklist.\n';

  const loaded = await reopened.load('code-review', ['references/checklist.md']);

  assert.equal(loaded.skill.version, '1.1.0');
  assert.match(loaded.entry.content, /version 1\.1\.0/);
  assert.equal(loaded.resources['references/checklist.md'], 'The new release checklist.\n');
  assert.equal(loaded.autoUpdate?.status, 'updated');
  assert.equal(loaded.autoUpdate?.fromVersion, '1.0.0');
  assert.equal(loaded.autoUpdate?.toVersion, '1.1.0');
  assert.ok(loaded.autoUpdate?.changes?.some(change => change.id === 'code-review' && change.from === '1.0.0' && change.to === '1.1.0'));
  assert.equal((await reopened.list()).skills.find(skill => skill.id === 'code-review')?.version, '1.1.0');
  assert.equal((await reopened.load('code-review')).autoUpdate?.status, 'current');
});

test('an existing runtime observes policy changes made by another runtime', async t => {
  const { fixture, runtime } = await installedFixture(t);
  const settings = await SkillFluxRuntime.open(fixture.project);
  await settings.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  assert.equal((await runtime.load('code-review')).skill.version, '1.1.0');

  await settings.setUpdatePolicy('manual');
  fixture.add('1.2.0');
  const before = await lockContents(fixture.project);
  const loaded = await runtime.load('code-review');

  assert.equal(loaded.autoUpdate?.mode, 'manual');
  assert.equal(loaded.autoUpdate?.status, 'manual');
  assert.equal(loaded.skill.version, '1.1.0');
  assert.equal(await lockContents(fixture.project), before);
});

test('follow consent authorizes updates independently of initial MCP installation consent', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.setUpdatePolicy('follow-compatible');
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await assert.rejects(runtime.installPlan(plan.id, 'mcp'), /has not preauthorized MCP installation/);
  await runtime.installPlan(plan.id, 'cli');
  fixture.add('1.1.0');

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.1.0');
  assert.equal(loaded.autoUpdate?.status, 'updated');
  const policy = JSON.parse(await readFile(join(fixture.project, '.skillflux', 'policy.json'), 'utf8'));
  assert.equal(policy.preauthorizeReviewedText, false);
});

test('MCP install preauthorization alone does not enable automatic upgrades', async t => {
  const { fixture, runtime } = await installedFixture(t);
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.preauthorizeReviewedText = true;
  policy.updatePolicy = 'manual';
  await writeFile(policyPath, JSON.stringify(policy));
  fixture.add('1.1.0');

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'manual');
});

test('unsafe release lines and incompatible releases preserve the installed version', async t => {
  const cases = [
    { name: 'major release', version: '2.0.0', options: {} },
    { name: 'breaking release', version: '1.1.0', options: { breaking: true } },
    { name: 'prerelease', version: '1.1.0-beta.1', options: {} },
    { name: 'unsupported host', version: '1.1.0', options: { hosts: ['claude'] as const } },
    { name: 'newer client required', version: '1.1.0', options: { minClient: '999.0.0' } },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async child => {
      const { fixture, runtime } = await installedFixture(child);
      await runtime.setUpdatePolicy('follow-compatible');
      fixture.add(scenario.version, { ...scenario.options, ...(scenario.options.hosts ? { hosts: [...scenario.options.hosts] } : {}) });
      const before = await lockContents(fixture.project);

      const loaded = await runtime.load('code-review');

      assert.equal(loaded.skill.version, '1.0.0');
      assert.equal(loaded.autoUpdate?.status, 'blocked');
      assert.ok(loaded.autoUpdate?.reason);
      assert.equal(await lockContents(fixture.project), before);
    });
  }
});

test('only approved and qualified versions can be followed', async t => {
  for (const scenario of [
    { status: 'pending', qualification: 'needs-testing' },
    { status: 'approved', qualification: 'needs-testing' },
    { status: 'revoked', qualification: 'revoked' },
  ]) {
    await t.test(`${scenario.status}/${scenario.qualification}`, async child => {
      const { fixture, runtime } = await installedFixture(child);
      await runtime.setUpdatePolicy('follow-compatible');
      fixture.add('1.1.0', scenario);
      const before = await lockContents(fixture.project);

      const loaded = await runtime.load('code-review');

      assert.equal(loaded.skill.version, '1.0.0');
      assert.notEqual(loaded.autoUpdate?.status, 'updated');
      assert.equal(await lockContents(fixture.project), before);
    });
  }
});

test('missing release metadata, permission expansion and maintainer changes require review', async t => {
  for (const scenario of ['metadata', 'permissions', 'publisher', 'maintainer'] as const) {
    await t.test(scenario, async child => {
      const { fixture, runtime } = await installedFixture(child);
      await runtime.setUpdatePolicy('follow-compatible');
      const release = fixture.add('1.1.0');
      if (scenario === 'metadata') delete release.manifest.release;
      if (scenario === 'permissions') release.manifest.permissions.network = ['https://example.com'];
      if (scenario === 'publisher') release.manifest.publisher = 'A different synthetic publisher';
      if (scenario === 'maintainer') release.manifest.release!.maintainedBy = 'A different synthetic maintainer';
      const before = await lockContents(fixture.project);

      const loaded = await runtime.load('code-review');

      assert.equal(loaded.skill.version, '1.0.0');
      assert.equal(loaded.autoUpdate?.status, 'blocked');
      assert.ok(loaded.autoUpdate?.reason);
      assert.equal(await lockContents(fixture.project), before);
    });
  }
});

test('follow picks the newest safe release within the compatible line', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  fixture.add('1.2.0', { breaking: true });
  fixture.add('2.0.0');

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.1.0');
  assert.equal(loaded.autoUpdate?.status, 'updated');
});

test('a non-breaking patch cannot silently cross an earlier breaking release', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0', { breaking: true });
  fixture.add('1.1.1');
  const before = await lockContents(fixture.project);

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'blocked');
  assert.equal(await lockContents(fixture.project), before);
});

test('0.x following stays within the installed minor line', async t => {
  const fixture = await fixtureCatalog(t);
  fixture.add('0.2.0', { id: 'experimental-review' });
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('experimental-review', { version: '0.2.0' });
  await runtime.installPlan(first.id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('0.3.0', { id: 'experimental-review' });

  const blocked = await runtime.load('experimental-review');

  assert.equal(blocked.skill.version, '0.2.0');
  assert.equal(blocked.autoUpdate?.status, 'blocked');
  fixture.add('0.2.1', { id: 'experimental-review' });
  const patched = await runtime.load('experimental-review');
  assert.equal(patched.skill.version, '0.2.1');
  assert.equal(patched.autoUpdate?.status, 'updated');
});

test('an update cannot remove a resource requested by the active load', async t => {
  const fixture = await fixtureCatalog(t);
  const initial = fixture.add('1.0.0');
  initial.files['references/checklist.md'] = 'Keep using this requested checklist.\n';
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  const before = await lockContents(fixture.project);

  const loaded = await runtime.load('code-review', ['references/checklist.md']);

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'blocked');
  assert.equal(loaded.resources['references/checklist.md'], initial.files['references/checklist.md']);
  assert.equal(await lockContents(fixture.project), before);
});

test('pinned skills stay fixed until explicitly unpinned', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  await runtime.setPinned('code-review', true);
  fixture.add('1.1.0');
  const before = await lockContents(fixture.project);

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'blocked');
  assert.equal(await lockContents(fixture.project), before);
  await runtime.setPinned('code-review', false);
  assert.equal((await runtime.load('code-review')).skill.version, '1.1.0');
});

test('the same load returns a coherent upgraded dependency graph', async t => {
  const fixture = await fixtureCatalog(t);
  fixture.add('1.0.0', { id: 'shared-checklist' });
  fixture.add('1.0.0', { deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0', { id: 'shared-checklist' });
  fixture.add('1.1.0', { deps: [{ id: 'shared-checklist', version: '1.1.0' }] });

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.1.0');
  assert.equal(loaded.dependencies.find(dependency => dependency.id === 'shared-checklist')?.version, '1.1.0');
  assert.match(loaded.dependencies[0]!.content, /version 1\.1\.0/);
  assert.deepEqual(loaded.autoUpdate?.changes?.map(change => change.id).sort(), ['code-review', 'shared-checklist']);
});

test('a breaking or pinned dependency blocks the entire automatic update', async t => {
  for (const scenario of ['breaking', 'pinned', 'shared conflict'] as const) {
    await t.test(scenario, async child => {
      const fixture = await fixtureCatalog(child);
      fixture.add('1.0.0', { id: 'shared-checklist' });
      fixture.add('1.0.0', { deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
      const runtime = await SkillFluxRuntime.open(fixture.project);
      const first = await runtime.createPlan('code-review', { version: '1.0.0' });
      await runtime.installPlan(first.id, 'cli');
      if (scenario === 'pinned') await runtime.setPinned('shared-checklist', true);
      if (scenario === 'shared conflict') {
        fixture.add('1.0.0', { id: 'other-review', deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
        const other = await runtime.createPlan('other-review', { version: '1.0.0' });
        await runtime.installPlan(other.id, 'cli');
      }
      await runtime.setUpdatePolicy('follow-compatible');
      fixture.add('1.1.0', { id: 'shared-checklist', breaking: scenario === 'breaking' });
      fixture.add('1.1.0', { deps: [{ id: 'shared-checklist', version: '1.1.0' }] });
      const before = await lockContents(fixture.project);

      const loaded = await runtime.load('code-review');

      assert.equal(loaded.skill.version, '1.0.0');
      assert.equal(loaded.dependencies[0]?.version, '1.0.0');
      assert.equal(loaded.autoUpdate?.status, 'blocked');
      assert.equal(await lockContents(fixture.project), before);
    });
  }
});

test('local edits are preserved and never returned as trusted loaded content', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  const path = join(fixture.project, '.skillflux', 'skills', 'code-review', '1.0.0', 'SKILL.md');
  await appendFile(path, '\nUser edit that must be preserved.\n');
  fixture.add('1.1.0');
  const before = await lockContents(fixture.project);
  const editedContent = await readFile(path, 'utf8');

  await assert.rejects(runtime.load('code-review'), /hash|modified|changed|mismatch|integrity/i);

  assert.equal(await readFile(path, 'utf8'), editedContent);
  assert.equal(await lockContents(fixture.project), before);
});

test('offline following uses verified installed content and discloses unknown freshness', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  // Even if the cached catalog already advertises an update, stale metadata
  // must not authorize applying it while the catalog cannot be refreshed.
  assert.equal((await runtime.checkUpdates('code-review', true)).items[0]?.latestVersion, '1.1.0');
  fixture.setOffline(true);
  const before = await lockContents(fixture.project);

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.match(loaded.entry.content, /version 1\.0\.0/);
  assert.equal(loaded.autoUpdate?.status, 'unknown');
  assert.ok(loaded.warnings.some(warning => /unknown|offline|unavailable/i.test(warning)));
  assert.equal(await lockContents(fixture.project), before);
});

test('a corrupt download aborts the update and keeps the last verified lock and content', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  fixture.tamper('code-review', '1.1.0', 'SKILL.md', 'Unverified replacement content.');
  const before = await lockContents(fixture.project);

  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.match(loaded.entry.content, /version 1\.0\.0/);
  assert.equal(loaded.autoUpdate?.status, 'blocked');
  assert.ok(loaded.autoUpdate?.reason);
  assert.equal(await lockContents(fixture.project), before);
});

test('rollback pins the restored version so following cannot immediately undo it', async t => {
  const { fixture, runtime } = await installedFixture(t);
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  assert.equal((await runtime.load('code-review')).skill.version, '1.1.0');

  const restored = await runtime.rollback('code-review');
  assert.equal(restored.skills['code-review']?.version, '1.0.0');
  assert.equal(restored.skills['code-review']?.pinned, true);
  const loaded = await runtime.load('code-review');

  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'blocked');
  await runtime.setPinned('code-review', false);
  assert.equal((await runtime.load('code-review')).skill.version, '1.1.0');
});

test('project-wide rollback pins all restored packages in an automatically upgraded graph', async t => {
  const fixture = await fixtureCatalog(t);
  fixture.add('1.0.0', { id: 'shared-checklist' });
  fixture.add('1.0.0', { deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0', { id: 'shared-checklist' });
  fixture.add('1.1.0', { deps: [{ id: 'shared-checklist', version: '1.1.0' }] });
  assert.equal((await runtime.load('code-review')).skill.version, '1.1.0');

  const restored = await runtime.rollback();

  assert.equal(restored.skills['code-review']?.version, '1.0.0');
  assert.equal(restored.skills['shared-checklist']?.version, '1.0.0');
  assert.equal(restored.skills['code-review']?.pinned, true);
  assert.equal(restored.skills['shared-checklist']?.pinned, true);
  const loaded = await runtime.load('code-review');
  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.dependencies[0]?.version, '1.0.0');
  assert.equal(loaded.autoUpdate?.status, 'blocked');
});
