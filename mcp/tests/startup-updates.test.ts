import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION, LoggingMessageNotificationSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createSkillFluxMcpServer, serveSkillFluxStdio } from '../src/mcp-server.js';
import { StartupUpdates } from '../src/startup-updates.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import type { UpdateCheckItem, UpdateCheckResult } from '../src/runtime/model.js';
import { fixtureCatalog } from './runtime-fixture.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function item(id = 'code-review', status: UpdateCheckItem['status'] = 'update-available'): UpdateCheckItem {
  return {
    id, status, currentVersion: '1.0.0', latestVersion: status === 'unknown' ? null : '1.1.0',
    latestCompatibleVersion: status === 'unknown' ? null : '1.1.0', pinned: false,
    notes: null, breaking: false, compatibility: status === 'unknown' ? 'unknown' : 'compatible',
    revocationStatus: status === 'unknown' ? 'unknown' : 'clear',
    checkedAt: status === 'unknown' ? null : '2026-10-11T00:00:00.000Z',
    source: status === 'unknown' ? 'unavailable' : 'catalog', warnings: [],
  };
}

function checkResult(items = [item()], lockRevision = 1): UpdateCheckResult {
  return { projectRoot: '/synthetic-project', lockRevision, checkedAt: '2026-10-11T00:00:00.000Z', cacheTtlHours: 24, items };
}

function coordinatorFixture() {
  const checked = deferred<UpdateCheckResult>();
  let revision = 1;
  let checks = 0;
  let signal: AbortSignal | undefined;
  const notifications: number[] = [];
  const startup = new StartupUpdates({
    checkUpdates: async (_skillId, force, abortSignal) => {
      checks += 1;
      assert.equal(force, true);
      signal = abortSignal;
      return checked.promise;
    },
    list: async () => ({ projectRoot: '/synthetic-project', revision, skills: [] }),
  }, async count => { notifications.push(count); });
  return {
    startup, checked, notifications,
    checks: () => checks, signal: () => signal,
    setRevision: (value: number) => { revision = value; },
  };
}

async function installedFixture(t: TestContext) {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.installPlan((await runtime.createPlan('code-review', { version: '1.0.0' })).id, 'cli');
  return { fixture, runtime };
}

async function connectMcp(t: TestContext, runtime: SkillFluxRuntime) {
  const server = createSkillFluxMcpServer(runtime);
  const client = new Client({ name: 'startup-update-test', version: '1.0.0' });
  const notifications: unknown[] = [];
  const notified = deferred<void>();
  client.setNotificationHandler(LoggingMessageNotificationSchema, notification => {
    notifications.push(notification.params.data);
    notified.resolve();
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  t.after(() => client.close());
  await client.connect(clientTransport);
  return { client, notifications, notified };
}

function notices(result: CallToolResult): string[] {
  return result.content.flatMap(content => content.type === 'text' && content.text.startsWith('SkillFlux startup update check') ? [content.text] : []);
}

test('startup checks once, stays nonblocking, and only one concurrent reader receives the notice', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  fixture.startup.start();
  assert.equal(fixture.checks(), 1);
  assert.equal(await fixture.startup.takeNotice(), undefined, 'pending network must not block a tool response');
  fixture.checked.resolve(checkResult([item(), item('already-current', 'current')]));
  await nextTurn();
  assert.deepEqual(fixture.notifications, [1]);
  const results = await Promise.all(Array.from({ length: 8 }, () => fixture.startup.takeNotice()));
  const delivered = results.filter((value): value is string => value !== undefined);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!, /code-review@1\.0\.0: status=update-available/);
  assert.doesNotMatch(delivered[0]!, /already-current/);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('foreground results cover skills before and after the background check completes', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  fixture.startup.cover([item('loaded-first')]);
  fixture.checked.resolve(checkResult([item('loaded-first'), item('checked-after'), item('remaining')]));
  await nextTurn();
  fixture.startup.cover([item('checked-after')]);
  const notice = await fixture.startup.takeNotice();
  assert.ok(notice);
  assert.match(notice, /remaining@/);
  assert.doesNotMatch(notice, /loaded-first@|checked-after@/);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('a tool that consumes the notice during startup validation prevents a late logging reminder', async () => {
  const firstListEntered = deferred<void>();
  const releaseFirstList = deferred<void>();
  const notifications: number[] = [];
  let lists = 0;
  const startup = new StartupUpdates({
    checkUpdates: async () => checkResult(),
    list: async () => {
      if (++lists === 1) {
        firstListEntered.resolve();
        await releaseFirstList.promise;
      }
      return { projectRoot: '/synthetic-project', revision: 1, skills: [] };
    },
  }, async count => { notifications.push(count); });
  startup.start();
  await firstListEntered.promise;
  assert.match((await startup.takeNotice())!, /code-review@1\.0\.0: status=update-available/);
  releaseFirstList.resolve();
  await nextTurn();
  assert.deepEqual(notifications, [], 'startup must not remind again after a foreground tool delivered the notice');
  assert.equal(await startup.takeNotice(), undefined);
});

test('covering an older cached status preserves fresh changes; matching status ignores delivery metadata', async t => {
  await t.test('old cached current result cannot cover a new available version', async () => {
    const fixture = coordinatorFixture();
    fixture.startup.start();
    fixture.startup.cover([{
      ...item('code-review', 'current'), latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0', source: 'cache',
    }]);
    fixture.checked.resolve(checkResult());
    await nextTurn();
    assert.deepEqual(fixture.notifications, [1]);
    assert.match((await fixture.startup.takeNotice())!, /status=update-available; latest=1\.1\.0/);
  });
  await t.test('same result from an earlier cache check remains covered', async () => {
    const fixture = coordinatorFixture();
    fixture.startup.start();
    fixture.startup.cover([{ ...item(), source: 'cache', checkedAt: '2026-10-10T00:00:00.000Z' }]);
    fixture.checked.resolve(checkResult());
    await nextTurn();
    assert.deepEqual(fixture.notifications, []);
    assert.equal(await fixture.startup.takeNotice(), undefined);
  });
});

test('an older live foreground result cannot cover a newer pending startup result', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  fixture.checked.resolve(checkResult());
  await nextTurn();
  fixture.startup.cover([{
    ...item('code-review', 'current'), latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0',
    source: 'catalog', checkedAt: '2026-10-10T00:00:00.000Z',
  }]);
  assert.match((await fixture.startup.takeNotice())!, /status=update-available; latest=1\.1\.0/);
});

test('a late older startup update is suppressed by a fresh foreground result already reported', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  const current = {
    ...item('code-review', 'current'), latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0',
    checkedAt: '2026-10-12T00:00:00.000Z',
  };
  fixture.startup.cover([current]);
  // Concurrent foreground checks may themselves finish out of order; retain
  // the newest reported observation instead of regressing to the latest arrival.
  fixture.startup.cover([{ ...current, checkedAt: '2026-10-10T00:00:00.000Z' }]);
  assert.equal(await fixture.startup.takeNotice(), undefined);
  fixture.checked.resolve(checkResult([item()]));
  await nextTurn();
  assert.deepEqual(fixture.notifications, []);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('a late unknown startup result does not contradict a fresh foreground result already reported', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  fixture.startup.cover([{
    ...item('code-review', 'current'), latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0',
  }]);
  fixture.checked.resolve(checkResult([item('code-review', 'unknown')]));
  await nextTurn();
  assert.deepEqual(fixture.notifications, []);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('a late newer startup update remains visible after an older live foreground result', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  fixture.startup.cover([{
    ...item('code-review', 'current'), latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0',
    checkedAt: '2026-10-10T00:00:00.000Z',
  }]);
  fixture.checked.resolve(checkResult([item()]));
  await nextTurn();
  assert.deepEqual(fixture.notifications, [1]);
  assert.match((await fixture.startup.takeNotice())!, /status=update-available; latest=1\.1\.0/);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('changed project lock discards a startup snapshot before notification or before delivery', async t => {
  for (const timing of ['before-check', 'before-delivery']) {
    await t.test(timing, async () => {
      const fixture = coordinatorFixture();
      fixture.startup.start();
      if (timing === 'before-check') fixture.setRevision(2);
      fixture.checked.resolve(checkResult());
      await nextTurn();
      if (timing === 'before-delivery') fixture.setRevision(2);
      assert.equal(await fixture.startup.takeNotice(), undefined);
      assert.deepEqual(fixture.notifications, timing === 'before-check' ? [] : [1]);
    });
  }
});

test('closing aborts startup work and ignores a late result without restarting', async () => {
  const fixture = coordinatorFixture();
  fixture.startup.start();
  assert.equal(fixture.signal()?.aborted, false);
  fixture.startup.close();
  assert.equal(fixture.signal()?.aborted, true);
  fixture.checked.resolve(checkResult());
  await nextTurn();
  fixture.startup.start();
  assert.equal(fixture.checks(), 1);
  assert.deepEqual(fixture.notifications, []);
  assert.equal(await fixture.startup.takeNotice(), undefined);
});

test('failed startup checks are contained and current-only results stay silent', async t => {
  await t.test('check rejection', async () => {
    const fixture = coordinatorFixture();
    fixture.startup.start();
    fixture.checked.reject(new Error('Synthetic local state failure'));
    await nextTurn();
    assert.equal(await fixture.startup.takeNotice(), undefined);
    assert.deepEqual(fixture.notifications, []);
  });
  await t.test('current-only result', async () => {
    const fixture = coordinatorFixture();
    fixture.startup.start();
    fixture.checked.resolve(checkResult([item('code-review', 'current')]));
    await nextTurn();
    assert.equal(await fixture.startup.takeNotice(), undefined);
    assert.deepEqual(fixture.notifications, []);
  });
  await t.test('failed notification preserves the tool-response fallback', async () => {
    const startup = new StartupUpdates({
      checkUpdates: async () => checkResult(),
      list: async () => ({ projectRoot: '/synthetic-project', revision: 1, skills: [] }),
    }, async () => { throw new Error('Synthetic notification transport failure'); });
    startup.start();
    await nextTurn();
    assert.match((await startup.takeNotice())!, /code-review@1\.0\.0: status=update-available/);
    assert.equal(await startup.takeNotice(), undefined);
  });
});

test('empty projects perform no catalog request, including at MCP startup', { timeout: 5_000 }, async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const requestsBeforeStartup = [...fixture.requests];
  const originalCheck = runtime.checkUpdates.bind(runtime);
  const completed = deferred<UpdateCheckResult>();
  let checks = 0;
  runtime.checkUpdates = async (...args) => {
    checks += 1;
    const result = await originalCheck(...args);
    completed.resolve(result);
    return result;
  };
  const { client, notifications } = await connectMcp(t, runtime);
  assert.deepEqual((await completed.promise).items, []);
  const listed = await client.callTool({ name: 'skillflux.list', arguments: {} });
  assert.equal(notices(listed as CallToolResult).length, 0);
  assert.equal(checks, 1);
  assert.deepEqual(fixture.requests, requestsBeforeStartup, 'startup must not make any network request for an empty project');
  assert.deepEqual(notifications, []);
});

test('MCP initialization and foreground tools do not wait for startup; fallback is once and preserves data', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.add('1.1.0');
  await runtime.setUpdatePolicy('follow-compatible');
  const snapshot = await runtime.checkUpdates();
  const lockBefore = await readFile(runtime.paths.lock, 'utf8');
  const policyBefore = await readFile(runtime.paths.policy, 'utf8');
  const checked = deferred<UpdateCheckResult>();
  const started = deferred<void>();
  let checks = 0;
  runtime.checkUpdates = async () => { checks += 1; started.resolve(); return checked.promise; };
  const { client, notified, notifications } = await connectMcp(t, runtime);
  await started.promise;
  await client.notification({ method: 'notifications/initialized' });
  const before = await client.callTool({ name: 'skillflux.list', arguments: {} });
  assert.equal(notices(before as CallToolResult).length, 0);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'skillflux.load'));
  assert.equal(checks, 1);
  checked.resolve(snapshot);
  await notified.promise;
  const [first, second] = await Promise.all([
    client.callTool({ name: 'skillflux.list', arguments: {} }),
    client.callTool({ name: 'skillflux.list', arguments: {} }),
  ]);
  assert.equal(notices(first as CallToolResult).length + notices(second as CallToolResult).length, 1);
  assert.deepEqual(first.structuredContent, before.structuredContent);
  assert.deepEqual(second.structuredContent, before.structuredContent);
  assert.equal(notifications.length, 1);
  assert.equal(await readFile(runtime.paths.lock, 'utf8'), lockBefore, 'startup must not follow updates');
  assert.equal(await readFile(runtime.paths.policy, 'utf8'), policyBefore);
  assert.equal(checks, 1, 'tool response fallback must not initiate another check');
});

test('MCP load and explicit checks cover the same skill even when startup finishes later', { timeout: 10_000 }, async t => {
  for (const tool of ['skillflux.load', 'skillflux.check_updates']) {
    await t.test(tool, { timeout: 5_000 }, async t => {
      const { fixture, runtime } = await installedFixture(t);
      fixture.add('1.1.0');
      const originalCheck = runtime.checkUpdates.bind(runtime);
      const snapshot = await originalCheck();
      const checked = deferred<UpdateCheckResult>();
      const started = deferred<void>();
      const startupComparedLock = deferred<void>();
      const originalList = runtime.list.bind(runtime);
      let released = false;
      runtime.list = async () => {
        const listed = await originalList();
        if (released) startupComparedLock.resolve();
        return listed;
      };
      let checks = 0;
      runtime.checkUpdates = async (...args) => {
        if (++checks === 1) { started.resolve(); return checked.promise; }
        return originalCheck(...args);
      };
      const { client, notifications } = await connectMcp(t, runtime);
      await started.promise;
      const explicit = await client.callTool({ name: tool, arguments: { skillId: 'code-review' } });
      assert.ok(!explicit.isError);
      assert.equal(notices(explicit as CallToolResult).length, 0);
      released = true;
      checked.resolve(snapshot);
      await startupComparedLock.promise;
      await nextTurn();
      const later = await client.callTool({ name: 'skillflux.list', arguments: {} });
      assert.equal(notices(later as CallToolResult).length, 0, 'already reported skill must not reappear in startup notice');
      assert.deepEqual(notifications, []);
      assert.equal(checks, tool === 'skillflux.check_updates' ? 2 : 1);
    });
  }
});

test('a cached MCP check does not swallow the newer startup result that arrives afterward', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.add('1.1.0');
  const fetchIndex = runtime.client.fetchIndex.bind(runtime.client);
  const entered = deferred<void>();
  const release = deferred<void>();
  runtime.client.fetchIndex = async options => {
    entered.resolve();
    await release.promise;
    return fetchIndex(options);
  };
  const { client, notified } = await connectMcp(t, runtime);
  await entered.promise;
  const cached = await client.callTool({ name: 'skillflux.check_updates', arguments: { force: false } });
  assert.ok(!cached.isError);
  const checked = cached.structuredContent as unknown as UpdateCheckResult;
  assert.equal(checked.items[0]?.status, 'current');
  assert.equal(checked.items[0]?.latestVersion, '1.0.0');
  assert.equal(checked.items[0]?.source, 'cache');
  release.resolve();
  await notified.promise;
  const later = await client.callTool({ name: 'skillflux.list', arguments: {} });
  const delivered = notices(later as CallToolResult);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!, /code-review@1\.0\.0: status=update-available; latest=1\.1\.0/);
  const repeated = await client.callTool({ name: 'skillflux.list', arguments: {} });
  assert.equal(notices(repeated as CallToolResult).length, 0);
});

test('a successful fresh MCP check supersedes a pending startup failure after connectivity returns', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  const originalCheck = runtime.checkUpdates.bind(runtime);
  const checkedResults: UpdateCheckResult[] = [];
  runtime.checkUpdates = async (...args) => {
    const checked = await originalCheck(...args);
    checkedResults.push(checked);
    return checked;
  };
  fixture.setOffline(true);
  const { client, notified } = await connectMcp(t, runtime);
  await notified.promise;
  assert.equal(checkedResults[0]?.items[0]?.status, 'unknown');
  assert.equal(checkedResults[0]?.items[0]?.source, 'unavailable');
  assert.equal(checkedResults[0]?.items[0]?.checkedAt, null);

  fixture.setOffline(false);
  const fresh = await client.callTool({ name: 'skillflux.check_updates', arguments: { force: true } });
  assert.ok(!fresh.isError);
  const result = fresh.structuredContent as unknown as UpdateCheckResult;
  assert.equal(result.items[0]?.status, 'current');
  assert.equal(result.items[0]?.source, 'catalog');
  assert.equal(notices(fresh as CallToolResult).length, 0, 'fresh current response must not also report the superseded startup failure');
  const later = await client.callTool({ name: 'skillflux.list', arguments: {} });
  assert.equal(notices(later as CallToolResult).length, 0);
});

test('a fresh MCP check supersedes a pending update notice when that newer release is withdrawn', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.add('1.1.0');
  const originalCheck = runtime.checkUpdates.bind(runtime);
  const checkedResults: UpdateCheckResult[] = [];
  runtime.checkUpdates = async (...args) => {
    const checked = await originalCheck(...args);
    checkedResults.push(checked);
    return checked;
  };
  const { client, notified } = await connectMcp(t, runtime);
  await notified.promise;
  const startup = checkedResults[0]!;
  assert.equal(startup.items[0]?.status, 'update-available');
  assert.equal(startup.items[0]?.latestVersion, '1.1.0');
  fixture.revoke('code-review', '1.1.0');

  const fresh = await client.callTool({ name: 'skillflux.check_updates', arguments: { force: true } });
  assert.ok(!fresh.isError);
  const result = fresh.structuredContent as unknown as UpdateCheckResult;
  assert.equal(result.lockRevision, startup.lockRevision, 'this race concerns catalog changes, not local version changes');
  assert.equal(result.items[0]?.status, 'current');
  assert.equal(result.items[0]?.latestVersion, '1.0.0');
  assert.equal(result.items[0]?.source, 'catalog');
  assert.ok(Date.parse(result.items[0]!.checkedAt!) >= Date.parse(startup.items[0]!.checkedAt!));
  assert.equal(notices(fresh as CallToolResult).length, 0, 'fresh catalog result must not also recommend the withdrawn release');
  const later = await client.callTool({ name: 'skillflux.list', arguments: {} });
  assert.equal(notices(later as CallToolResult).length, 0);
});

test('offline startup exposes unknown instead of claiming the installed version is latest', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.setOffline(true);
  const result = await runtime.checkUpdates(undefined, true);
  assert.equal(result.items[0]?.status, 'unknown');
  assert.equal(result.items[0]?.latestVersion, null);
  assert.equal(result.items[0]?.source, 'unavailable');
  const fixtureState = coordinatorFixture();
  fixtureState.setRevision(result.lockRevision);
  fixtureState.startup.start();
  fixtureState.checked.resolve(result);
  await nextTurn();
  const notice = await fixtureState.startup.takeNotice();
  assert.ok(notice);
  assert.match(notice, /status=unknown; latest=unknown/);
  assert.match(notice, /latest version could not be confirmed/);
  assert.doesNotMatch(notice, /status=current|up.to.date/);
});

test('overlapping startup and foreground refresh share a fetch, but a later load still checks revocations', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.add('1.1.0');
  const fetchIndex = runtime.client.fetchIndex.bind(runtime.client);
  const entered = deferred<void>();
  const release = deferred<void>();
  let fetches = 0;
  runtime.client.fetchIndex = async options => {
    fetches += 1;
    if (fetches === 1) { entered.resolve(); await release.promise; }
    return fetchIndex(options);
  };
  const startedCheck = runtime.checkUpdates(undefined, true, new AbortController().signal);
  await entered.promise;
  const foreground = runtime.checkUpdates('code-review', true);
  const loaded = runtime.load('code-review');
  // Keep the actual catalog fetch suspended while the local lock/cache reads run.
  // This tests genuine overlapping operations without weakening later forced checks.
  await new Promise(resolve => setTimeout(resolve, 30));
  release.resolve();
  const [backgroundResult, foregroundResult, loadedResult] = await Promise.all([startedCheck, foreground, loaded]);
  assert.equal(fetches, 1);
  assert.equal(backgroundResult.items[0]?.status, 'update-available');
  assert.equal(foregroundResult.items[0]?.status, 'update-available');
  assert.equal(loadedResult.skill.version, '1.0.0');
  fixture.revoke('code-review', '1.0.0');
  await assert.rejects(runtime.load('code-review'), { code: 'SKILL_REVOKED' });
  assert.equal(fetches, 2, 'a completed startup fetch must not mask a later revocation');
});

test('a refresh finishing after a local pin change describes the latest lock revision', { timeout: 5_000 }, async t => {
  const { fixture, runtime } = await installedFixture(t);
  fixture.add('1.1.0');
  const fetchIndex = runtime.client.fetchIndex.bind(runtime.client);
  const entered = deferred<void>();
  const release = deferred<void>();
  runtime.client.fetchIndex = async options => { entered.resolve(); await release.promise; return fetchIndex(options); };
  const checked = runtime.checkUpdates();
  await entered.promise;
  await runtime.setPinned('code-review', true);
  const current = await runtime.list();
  release.resolve();
  const result = await checked;
  assert.equal(result.lockRevision, current.revision);
  assert.equal(result.items[0]?.pinned, true);
});

test('stdio EOF aborts the startup check, removes listeners, and suppresses late output', { timeout: 5_000 }, async t => {
  const fixture = await fixtureCatalog(t);
  const input = new PassThrough();
  const output = new PassThrough();
  t.after(() => { input.destroy(); output.destroy(); });
  const checked = deferred<UpdateCheckResult>();
  const started = deferred<AbortSignal>();
  const aborted = deferred<void>();
  const initialized = deferred<void>();
  const messages: { jsonrpc: string; id?: number; result?: unknown; method?: string }[] = [];
  let outputBuffer = '';
  let abortEvents = 0;
  const checkMock = t.mock.method(SkillFluxRuntime.prototype, 'checkUpdates', async (_id?: string, force?: boolean, signal?: AbortSignal) => {
    assert.equal(force, true);
    assert.ok(signal);
    signal.addEventListener('abort', () => { abortEvents += 1; aborted.resolve(); }, { once: true });
    started.resolve(signal);
    return checked.promise;
  });
  output.on('data', chunk => {
    outputBuffer += chunk.toString();
    let newline: number;
    while ((newline = outputBuffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(outputBuffer.slice(0, newline));
      outputBuffer = outputBuffer.slice(newline + 1);
      messages.push(message);
      if (message.id === 1) initialized.resolve();
    }
  });

  await serveSkillFluxStdio(fixture.project, { input, output });
  input.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {},
      clientInfo: { name: 'stdio-eof-test', version: '1.0.0' },
    },
  }) + '\n');
  await initialized.promise;
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const signal = await started.promise;
  assert.equal(signal.aborted, false);
  input.end();
  await aborted.promise;
  assert.equal(signal.aborted, true);
  const messagesAtEof = structuredClone(messages);
  input.destroy(); // EOF and close may both occur; disposal must remain idempotent.
  checked.resolve(checkResult([item()], 0));
  await nextTurn();
  await nextTurn();

  assert.equal(checkMock.mock.callCount(), 1);
  assert.equal(abortEvents, 1);
  assert.deepEqual(messages, messagesAtEof, 'a completed check must not write notifications after stdin closes');
  assert.equal(messages.length, 1, 'only the protocol initialize response should be emitted');
  assert.equal(messages[0]?.jsonrpc, '2.0');
  assert.ok(messages[0]?.result);
  assert.equal(outputBuffer, '', 'stdio output must contain complete JSON-RPC frames only');
  for (const event of ['data', 'error', 'end', 'close']) assert.equal(input.listenerCount(event), 0, `${event} listener must be removed`);
});

test('stdio input that ended before connection is closed without starting background work', { timeout: 5_000 }, async t => {
  const fixture = await fixtureCatalog(t);
  const input = new PassThrough();
  const output = new PassThrough();
  t.after(() => { input.destroy(); output.destroy(); });
  const checkMock = t.mock.method(SkillFluxRuntime.prototype, 'checkUpdates', async () => checkResult([]));
  let outputText = '';
  output.on('data', chunk => { outputText += chunk.toString(); });
  const closed = once(input, 'close');
  input.resume();
  input.end();
  await closed;
  assert.equal(input.readableEnded, true);
  await serveSkillFluxStdio(fixture.project, { input, output });
  await nextTurn();

  assert.equal(checkMock.mock.callCount(), 0);
  assert.equal(outputText, '');
  for (const event of ['data', 'error', 'end', 'close']) assert.equal(input.listenerCount(event), 0, `${event} listener must be removed`);
});
