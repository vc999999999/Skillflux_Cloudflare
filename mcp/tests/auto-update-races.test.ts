import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { fixtureCatalog } from './runtime-fixture.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import type { CatalogClient } from '../src/runtime/catalog-client.js';
import { SkillFluxError } from '../src/runtime/errors.js';
import { STATE_SCHEMA, type InstallJournal, type InstallResult } from '../src/runtime/model.js';
import { atomicWriteJson } from '../src/runtime/paths.js';
import { readLock } from '../src/runtime/project.js';

test('an update blocked by a newly revoked dependency never loads that dependency from an older index', async t => {
  const fixture = await fixtureCatalog(t);
  fixture.add('1.0.0', { id: 'shared-checklist' });
  fixture.add('1.0.0', { deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.installPlan((await runtime.createPlan('code-review', { version: '1.0.0' })).id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0', { deps: [{ id: 'shared-checklist', version: '1.0.0' }] });
  const client = Reflect.get(runtime, 'client') as CatalogClient;
  const fetchIndex = client.fetchIndex.bind(client);
  let reads = 0;
  client.fetchIndex = async () => {
    // The initial load check sees an eligible upgrade. Its executor discovers
    // the revocation during the mandatory second live catalog check.
    if (++reads === 2) fixture.revoke('shared-checklist', '1.0.0');
    return fetchIndex();
  };

  await assert.rejects(runtime.load('code-review'), { code: 'SKILL_REVOKED' });

  assert.ok(reads >= 2);
  assert.equal((await readLock(runtime.paths)).skills['code-review'].version, '1.0.0');
});

test('load reports the actual upgraded version after recovering a materialized automatic installation', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.installPlan((await runtime.createPlan('code-review', { version: '1.0.0' })).id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  const previous = await readLock(runtime.paths);
  type ExecutePlan = (planId: string, actor: 'cli' | 'mcp', authorizeUpdate: boolean, automatic?: { resources: string[] }) => Promise<InstallResult>;
  const executePlan = Reflect.get(runtime, 'executePlan').bind(runtime) as ExecutePlan;
  let interrupted = false;
  Reflect.set(runtime, 'executePlan', async (...args: Parameters<ExecutePlan>) => {
    const result = await executePlan(...args);
    if (!args[3] || interrupted) return result;
    interrupted = true;
    // The real executor verifies and materializes the new package. Recreate
    // exactly the durable state immediately before its final lock write.
    const next = await readLock(runtime.paths);
    const journal: InstallJournal = {
      schema: STATE_SCHEMA,
      operation: 'install',
      phase: 'materialized',
      transactionId: randomUUID(),
      previousLock: previous,
      nextLock: next,
      createdAt: new Date().toISOString(),
    };
    await atomicWriteJson(runtime.paths.journal, journal);
    await atomicWriteJson(runtime.paths.lock, previous);
    throw new SkillFluxError('INJECTED_COMMIT_INTERRUPTION', 'Synthetic interruption after package materialization');
  });

  const loaded = await runtime.load('code-review');

  assert.equal(interrupted, true);
  assert.equal((await readLock(runtime.paths)).skills['code-review'].version, '1.1.0');
  assert.equal(loaded.skill.version, '1.1.0');
  assert.match(loaded.entry.content, /version 1\.1\.0/);
  assert.equal(loaded.autoUpdate?.status, 'updated');
  assert.equal(loaded.autoUpdate?.fromVersion, '1.0.0');
  assert.equal(loaded.autoUpdate?.toVersion, loaded.skill.version);
  await assert.rejects(access(runtime.paths.journal), { code: 'ENOENT' });
});

test('a rollback after automatic installation cannot leave the load response claiming the replaced upgrade', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.installPlan((await runtime.createPlan('code-review', { version: '1.0.0' })).id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');
  type ExecutePlan = (planId: string, actor: 'cli' | 'mcp', authorizeUpdate: boolean, automatic?: { resources: string[] }) => Promise<InstallResult>;
  const executePlan = Reflect.get(runtime, 'executePlan').bind(runtime) as ExecutePlan;
  let rolledBack = false;
  Reflect.set(runtime, 'executePlan', async (...args: Parameters<ExecutePlan>) => {
    const result = await executePlan(...args);
    if (args[3] && !rolledBack) {
      rolledBack = true;
      // The automatic transaction has released the project mutex. An explicit
      // rollback can win that mutex before load resumes and re-reads its lock.
      await runtime.rollback('code-review', 'cli');
    }
    return result;
  });

  const loaded = await runtime.load('code-review');

  assert.equal(rolledBack, true);
  assert.equal(loaded.skill.version, '1.0.0');
  assert.match(loaded.entry.content, /version 1\.0\.0/);
  assert.notEqual(loaded.autoUpdate?.toVersion, '1.1.0', 'automatic update metadata must reflect the version actually loaded');
  assert.ok(loaded.autoUpdate?.reason, 'the response must explain why the completed upgrade is no longer loaded');
});
