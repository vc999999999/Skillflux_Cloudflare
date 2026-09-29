import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { QueuedAdEvent } from '../src/runtime/model.js';
import { atomicWriteJson } from '../src/runtime/paths.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import { installedRuntime } from './runtime-fixture.js';

test('an impression lost after the server recorded it queues locally and flushes into exactly one deduplicated impression', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  f.dropEvents(true);
  const queued = await f.runtime.recordImpression(selection);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.duplicate, false);
  assert.equal(f.adEvents.length, 1, 'The fixture recorded the event even though the response was lost');
  assert.equal((await f.runtime.privacyState()).queuedEvents, 1);
  f.dropEvents(false);
  const flush = await f.runtime.flushEventOutbox();
  assert.deepEqual(flush, { flushed: 1, dropped: 0, remaining: 0 });
  const impressions = f.adEvents.filter(event => event.type === 'impression');
  assert.equal(impressions.length, 2, 'The resent event reaches the server as a duplicate');
  assert.equal(new Set(impressions.map(event => event.token)).size, 1, 'The server shows exactly one impression after deduplication');
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
});

test('a failed flush keeps the queue until the registry is reachable again', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  f.offline(true);
  assert.equal((await f.runtime.recordImpression(selection)).status, 'queued');
  const failed = await f.runtime.flushEventOutbox();
  assert.deepEqual(failed, { flushed: 0, dropped: 0, remaining: 1 });
  assert.equal((await f.runtime.privacyState()).queuedEvents, 1);
  assert.equal(f.adEvents.length, 0);
  f.offline(false);
  const retried = await f.runtime.flushEventOutbox();
  assert.deepEqual(retried, { flushed: 1, dropped: 0, remaining: 0 });
  assert.equal(f.adEvents.length, 1);
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
});

test('disabling advertising clears the queue and blocks every new ad event', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  f.offline(true);
  assert.equal((await f.runtime.recordImpression(selection)).status, 'queued');
  f.offline(false);
  await f.runtime.setAdvertising(false);
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
  await assert.rejects(f.runtime.recordImpression(selection), /disabled/i);
  await assert.rejects(f.runtime.hideAd(selection), /disabled/i);
  await assert.rejects(f.runtime.reportAd(selection, 'Synthetic report reason'), /disabled/i);
  assert.equal(f.adEvents.length, 0, 'No event is produced or sent after opt-out');
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
});

test('a long-lived runtime flush respects a later advertising opt-out and clears instead of sending', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  f.offline(true);
  assert.equal((await f.runtime.recordImpression(selection)).status, 'queued');
  const other = await SkillFluxRuntime.open(f.project);
  await other.setAdvertising(false);
  f.offline(false);
  const flush = await f.runtime.flushEventOutbox();
  assert.deepEqual(flush, { flushed: 0, dropped: 0, remaining: 0 });
  assert.equal(f.adEvents.length, 0, 'Queued events are discarded, not sent, once ads are disabled');
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
});

test('hide and report events are reported honestly and reports require a reason', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  const hidden = await f.runtime.hideAd(selection);
  assert.equal(hidden.type, 'hide');
  assert.equal(hidden.status, 'reported');
  assert.equal(hidden.duplicate, false);
  await assert.rejects(f.runtime.reportAd(selection, ''), /reason/);
  await assert.rejects(f.runtime.reportAd(selection, 'x'.repeat(1001)), /reason/);
  const reported = await f.runtime.reportAd(selection, 'Synthetic report reason');
  assert.equal(reported.type, 'report');
  assert.equal(reported.status, 'reported');
  assert.equal(f.adEvents.filter(event => event.type === 'hide').length, 1);
  assert.equal(f.adEvents.filter(event => event.type === 'report').length, 1);
  assert.equal(f.adEvents.find(event => event.type === 'report')!.reason, 'Synthetic report reason');
  assert.equal((await f.runtime.privacyState()).queuedEvents, 0);
});

test('the outbox is bounded and drops the oldest events first', async t => {
  const f = await installedRuntime(t);
  f.enableAds(true);
  const selection = await f.runtime.selectAdvertisement('development', 'code-review', 'normal');
  const synthetic: QueuedAdEvent[] = Array.from({ length: 1000 }, (_, index) => ({
    token: `synthetic-token-${index}`,
    type: 'impression',
    eventId: `synthetic-event-${index}`,
    queuedAt: new Date().toISOString(),
  }));
  await atomicWriteJson(f.runtime.paths.eventOutbox, synthetic);
  f.offline(true);
  const queued = await f.runtime.recordImpression(selection);
  assert.equal(queued.status, 'queued');
  const events = JSON.parse(await readFile(f.runtime.paths.eventOutbox, 'utf8')) as QueuedAdEvent[];
  assert.equal(events.length, 1000);
  assert.equal(events[0]!.eventId, 'synthetic-event-1', 'The oldest queued event was dropped');
  assert.equal(events.at(-1)!.eventId, queued.eventId, 'The newest event is appended in order');
});
