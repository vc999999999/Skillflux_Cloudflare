import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  AdDecision,
  Bundle,
  Campaign,
  Catalog,
  PublicKeyInfo,
  Revocations,
  SearchResponse,
  Signed,
  SkillDetail,
  SkillSummary,
  Submission,
} from '../src/shared.js';
import { bundleDigest, verifyPayload } from '../src/shared.js';
import { createRegistryServer } from '../src/registry/server.js';
import { compareVersions } from '../src/registry/database.js';
import { seedSyntheticCatalog, recordSyntheticEvaluation, syntheticRelease } from './registry-fixture.js';

const seedPath = fileURLToPath(new URL('../catalog/seed.json', import.meta.url));
const adminToken = 'test-operator-token-with-entropy-83eb28908e';

interface RunningRegistry {
  baseUrl: string;
  dataDir: string;
  close: (removeData?: boolean) => Promise<void>;
}

async function startRegistry(options: {
  dataDir?: string;
  dev?: boolean;
  seed?: boolean;
  token?: string | undefined;
  allowedOrigins?: string[];
  trustedProxies?: string[];
} = {}): Promise<RunningRegistry> {
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), 'skillflux-registry-test-'));
  const server = await createRegistryServer({
    dataDir,
    adminToken: options.token === undefined ? adminToken : options.token,
    dev: false,
    ...(options.seed === false ? {} : { seedPath }),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  if (options.dev !== false && options.seed !== false) await seedSyntheticCatalog(`http://127.0.0.1:${address.port}`, adminToken);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    dataDir,
    close: async (removeData = true) => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      if (removeData) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function operatorHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}

function testSubmission(id: string, version = '1.0.0'): Submission {
  return {
    id,
    version,
    name: '\u5ba1\u6838\u6d4b\u8bd5 Skill',
    description: '\u7528\u4e8e\u9a8c\u8bc1\u771f\u5b9e\u63d0\u4ea4\u3001\u5ba1\u6838\u3001\u53d1\u5e03\u548c\u64a4\u56de\u6d41\u7a0b\u3002',
    category: 'development',
    tags: ['testing', '\u5ba1\u6838'],
    hosts: ['generic', 'codex'],
    publisher: 'Registry integration test',
    license: 'MIT',
    entry: 'SKILL.md',
    permissions: { network: [], shell: false, secrets: [] },
    dependencies: [],
    files: {
      'SKILL.md': '# Review test\n\nInspect the supplied change and report evidence.\n',
      'references/checklist.md': '# Checklist\n\nVerify inputs and observable outputs.\n',
    },
    release: syntheticRelease,
  };
}

test('explicit synthetic operator fixtures serve verifiable catalog, search, details and bundles', async () => {
  const registry = await startRegistry();
  try {
    const healthResponse = await fetch(`${registry.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await json(healthResponse), { status: 'ok', version: '1.0' });
    assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.match(healthResponse.headers.get('content-security-policy') ?? '', /default-src 'none'/);

    const keyResponse = await fetch(`${registry.baseUrl}/v1/keys`);
    assert.equal(keyResponse.status, 200);
    const key = await json<PublicKeyInfo>(keyResponse);
    assert.match(key.keyId, /^ed25519:[a-f0-9]{24}$/);
    assert.match(key.publicKey, /BEGIN PUBLIC KEY/);

    const catalogResponse = await fetch(`${registry.baseUrl}/v1/catalog`);
    const signedCatalog = await json<Signed<Catalog>>(catalogResponse);
    const catalog = verifyPayload(signedCatalog, key);
    assert.equal(catalog.skills.length, 9);
    assert.ok(catalog.skills.every(skill => skill.status === 'approved'));
    assert.ok(catalog.skills.every(skill => skill.quality.automated.passed));
    assert.ok(catalog.skills.every(skill => skill.quality.review?.reviewer === 'SkillFlux operator'));
    assert.ok(Date.parse(catalog.expiresAt) > Date.parse(catalog.generatedAt));

    const searchResponse = await fetch(`${registry.baseUrl}/v1/search?q=${encodeURIComponent('\u7f51\u7ad9 \u8bbe\u8ba1')}&host=codex&limit=2&offset=0`);
    assert.equal(searchResponse.status, 200);
    const search = await json<SearchResponse>(searchResponse);
    assert.equal(search.items[0]?.id, 'landing-page-design');
    assert.ok((search.items[0]?.score ?? 0) > 0);
    assert.ok((search.items[0]?.reasons ?? []).some(reason => reason.includes('\u5339\u914d')));
    assert.equal(search.limit, 2);
    assert.equal(search.offset, 0);
    assert.ok(search.categories.includes('development'));

    const browse = await json<SearchResponse>(await fetch(`${registry.baseUrl}/v1/search?limit=2&offset=2&sort=name`));
    assert.equal(browse.items.length, 2);
    assert.equal(browse.total, 9);
    assert.equal(browse.offset, 2);
    assert.ok(browse.items.every(item => item.score === undefined && item.reasons === undefined));

    const invalidHost = await fetch(`${registry.baseUrl}/v1/search?host=unknown`);
    assert.equal(invalidHost.status, 400);
    assert.equal((await json<{ error: { code: string } }>(invalidHost)).error.code, 'invalid_query');

    const detailResponse = await fetch(`${registry.baseUrl}/v1/skills/landing-page-design`);
    assert.equal(detailResponse.status, 200);
    const detail = await json<SkillDetail>(detailResponse);
    assert.equal(detail.manifest.id, 'landing-page-design');
    assert.match(detail.content, /Landing page design/);
    assert.deepEqual(detail.resources, ['references/review.md']);

    const bundleResponse = await fetch(`${registry.baseUrl}/v1/bundles/${detail.skill.digest}`);
    assert.equal(bundleResponse.status, 200);
    assert.equal(bundleResponse.headers.get('cache-control'), 'no-store');
    const signedBundle = await json<Signed<Bundle>>(bundleResponse);
    const bundle = verifyPayload(signedBundle, key);
    assert.equal(bundleDigest(bundle), detail.skill.digest);
    assert.equal(bundle.manifest.quality.review?.reviewer, 'SkillFlux operator');

    const missingBundle = await fetch(`${registry.baseUrl}/v1/bundles/${'a'.repeat(64)}`);
    assert.equal(missingBundle.status, 404);
  } finally {
    await registry.close();
  }
});

test('operator workflow quarantines, scans, approves immutably, rejects unsafe capabilities and revokes with signed evidence', async () => {
  const registry = await startRegistry({ dev: false, seed: false });
  try {
    const unauthenticated = await fetch(`${registry.baseUrl}/v1/admin/skills`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate') ?? '', /Bearer/);

    const submission = testSubmission('review-flow');
    const submittedResponse = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST',
      headers: operatorHeaders(),
      body: JSON.stringify(submission),
    });
    assert.equal(submittedResponse.status, 201);
    const submitted = await json<{ skill: SkillSummary }>(submittedResponse);
    assert.equal(submitted.skill.status, 'pending');
    assert.equal(submitted.skill.quality.automated.passed, true);
    assert.equal(submitted.skill.quality.review, null);
    assert.ok(submitted.skill.quality.automated.checks.includes('secret-pattern-scan'));

    const hiddenBeforeApproval = await fetch(`${registry.baseUrl}/v1/skills/review-flow`);
    assert.equal(hiddenBeforeApproval.status, 404);

    await recordSyntheticEvaluation(registry.baseUrl, adminToken, 'review-flow', '1.0.0');
    const approvedResponse = await fetch(`${registry.baseUrl}/v1/admin/skills/review-flow/1.0.0/review`, {
      method: 'POST',
      headers: operatorHeaders(),
      body: JSON.stringify({ action: 'approve', reviewer: 'operator@example.test', notes: 'Reviewed the submitted instructional text and automated evidence.' }),
    });
    assert.equal(approvedResponse.status, 200);
    const approved = await json<{ skill: SkillSummary }>(approvedResponse);
    assert.equal(approved.skill.status, 'approved');
    assert.equal(approved.skill.quality.review?.reviewer, 'SkillFlux operator');

    const publicDetail = await json<SkillDetail>(await fetch(`${registry.baseUrl}/v1/skills/review-flow?version=1.0.0`));
    assert.equal(publicDetail.skill.digest, approved.skill.digest);

    const dependent = testSubmission('review-dependent');
    dependent.dependencies = [{ id: 'review-flow', version: '1.0.0' }];
    assert.equal((await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify(dependent),
    })).status, 201);
    await recordSyntheticEvaluation(registry.baseUrl, adminToken, 'review-dependent', '1.0.0');
    assert.equal((await fetch(`${registry.baseUrl}/v1/admin/skills/review-dependent/1.0.0/review`, {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ action: 'approve', reviewer: 'operator@example.test', notes: 'Dependency and contents reviewed.' }),
    })).status, 200);

    const overwritten = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST',
      headers: operatorHeaders(),
      body: JSON.stringify({ ...submission, description: 'Attempted overwrite.' }),
    });
    assert.equal(overwritten.status, 409);
    assert.equal((await json<{ error: { code: string } }>(overwritten)).error.code, 'version_immutable');

    const unsafePermissions = testSubmission('unsafe-network');
    unsafePermissions.permissions.network = ['https://example.com'];
    const unsafePermissionsResponse = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify(unsafePermissions),
    });
    assert.equal(unsafePermissionsResponse.status, 422);
    assert.equal((await json<{ error: { code: string } }>(unsafePermissionsResponse)).error.code, 'unsupported_permissions');

    const reserved = testSubmission('reserved-file');
    reserved.entry = 'manifest.json';
    reserved.files = { 'manifest.json': '# Not runtime metadata\n' };
    const reservedResponse = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify(reserved),
    });
    assert.equal(reservedResponse.status, 201);
    const reservedSkill = await json<{ skill: SkillSummary }>(reservedResponse);
    assert.equal(reservedSkill.skill.quality.automated.passed, false);
    const reservedApproval = await fetch(`${registry.baseUrl}/v1/admin/skills/reserved-file/1.0.0/review`, {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ action: 'approve', reviewer: 'operator', notes: 'Should be blocked.' }),
    });
    assert.equal(reservedApproval.status, 409);
    assert.equal((await json<{ error: { code: string } }>(reservedApproval)).error.code, 'automated_checks_failed');

    const collision = testSubmission('case-collision');
    collision.files = {
      'SKILL.md': collision.files['SKILL.md']!,
      'references/A.md': 'Uppercase path.\n',
      'references/a.md': 'Lowercase path.\n',
    };
    const collisionResponse = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify(collision),
    });
    assert.equal(collisionResponse.status, 201);
    assert.equal((await json<{ skill: SkillSummary }>(collisionResponse)).skill.quality.automated.passed, false);

    const missingReason = await fetch(`${registry.baseUrl}/v1/admin/skills/review-flow/1.0.0/review`, {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ action: 'revoke', reviewer: 'security-operator', notes: '' }),
    });
    assert.equal(missingReason.status, 422);

    const revokedResponse = await fetch(`${registry.baseUrl}/v1/admin/skills/review-flow/1.0.0/review`, {
      method: 'POST', headers: operatorHeaders(),
      body: JSON.stringify({ action: 'revoke', reviewer: 'security-operator', notes: 'A concrete unsafe instruction was identified.' }),
    });
    assert.equal(revokedResponse.status, 200);
    assert.equal((await json<{ skill: SkillSummary }>(revokedResponse)).skill.status, 'revoked');
    assert.equal((await fetch(`${registry.baseUrl}/v1/skills/review-flow?version=1.0.0`)).status, 410);
    assert.equal((await fetch(`${registry.baseUrl}/v1/skills/review-dependent?version=1.0.0`)).status, 410);
    assert.equal((await fetch(`${registry.baseUrl}/v1/bundles/${approved.skill.digest}`)).status, 404);

    const key = await json<PublicKeyInfo>(await fetch(`${registry.baseUrl}/v1/keys`));
    const signedRevocations = await json<Signed<Revocations>>(await fetch(`${registry.baseUrl}/v1/revocations`));
    const revocations = verifyPayload(signedRevocations, key);
    assert.ok(revocations.items.some(item => item.id === 'review-flow' && item.reason === 'A concrete unsafe instruction was identified.'));
    assert.ok(revocations.items.some(item => item.id === 'review-dependent' && item.reason.includes('Dependency review-flow@1.0.0')));

    const audit = await json<{ items: Array<{ action: string }> }>(await fetch(`${registry.baseUrl}/v1/admin/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }));
    assert.ok(audit.items.some(item => item.action === 'skill.submitted'));
    assert.ok(audit.items.some(item => item.action === 'skill.approve'));
    assert.ok(audit.items.some(item => item.action === 'skill.revoke'));
  } finally {
    await registry.close();
  }
});

test('ad decisions use reviewed campaigns, signed idempotent tokens, local exclusions, event dedupe and click-only billing', async () => {
  const registry = await startRegistry({ dev: false, seed: false });
  try {
    const key = await json<PublicKeyInfo>(await fetch(`${registry.baseUrl}/v1/keys`));
    const initialHouseResponse = await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'development', context: 'normal', requestId: 'request-house-0001', placement: 'final-answer' }),
    });
    assert.equal(initialHouseResponse.status, 200);
    const house = verifyPayload(await json<Signed<AdDecision>>(initialHouseResponse), key);
    assert.equal(house.house, true);
    assert.equal(house.campaignId, null);
    assert.equal(house.disclosure, '\u5e7f\u544a');
    assert.match(house.text, /SkillFlux/);
    const houseClick = await fetch(house.url, { redirect: 'manual' });
    assert.equal(houseClick.status, 302);
    assert.equal(houseClick.headers.get('location'), registry.baseUrl);

    const privacyViolation = await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'development', requestId: 'request-private-0001', prompt: 'private task text' }),
    });
    assert.equal(privacyViolation.status, 422);
    assert.equal((await json<{ error: { code: string } }>(privacyViolation)).error.code, 'invalid_ad_request');

    const now = Date.now();
    const campaignInput: CampaignInput = {
      name: 'Developer tools campaign',
      sponsor: 'Example Developer Tools',
      text: 'Example Developer Tools\uff1a\u4e3a\u56e2\u961f\u63d0\u4f9b\u53ef\u5ba1\u8ba1\u7684\u534f\u4f5c\u5de5\u4f5c\u6d41\u3002',
      url: 'https://sponsor.example/product?source=skillflux',
      categories: ['development'],
      active: true,
      budgetCents: 100,
      cpcCents: 25,
      dailyCap: 10,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    };
    const campaignResponse = await fetch(`${registry.baseUrl}/v1/admin/campaigns`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify(campaignInput),
    });
    assert.equal(campaignResponse.status, 201);
    const campaign = (await json<{ campaign: Campaign }>(campaignResponse)).campaign;
    assert.equal(campaign.spentCents, 0);

    const decisionRequest = { category: 'development', context: 'normal', skillId: 'code-review', requestId: 'request-paid-0001', locale: 'zh-CN', placement: 'final-answer' } as const;
    const paidEnvelope = await json<Signed<AdDecision>>(await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decisionRequest),
    }));
    const paid = verifyPayload(paidEnvelope, key);
    assert.equal(paid.house, false);
    assert.equal(paid.campaignId, campaign.id);
    assert.match(paid.url, new RegExp(`^${registry.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/r/`));

    const repeatedEnvelope = await json<Signed<AdDecision>>(await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decisionRequest),
    }));
    assert.deepEqual(repeatedEnvelope, paidEnvelope);

    const reusedRequest = await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...decisionRequest, category: 'product' }),
    });
    assert.equal(reusedRequest.status, 409);

    const excludedEnvelope = await json<Signed<AdDecision>>(await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'development', context: 'normal', excludedCampaigns: [campaign.id], requestId: 'request-excluded-0001' }),
    }));
    assert.equal(verifyPayload(excludedEnvelope, key).house, true);

    const sensitiveResponse = await fetch(`${registry.baseUrl}/v1/ads/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'medical', requestId: 'request-sensitive-0001' }),
    });
    assert.equal(sensitiveResponse.status, 422);
    assert.equal((await json<{ error: { code: string } }>(sensitiveResponse)).error.code, 'ad_suppressed');

    const impression = await fetch(`${registry.baseUrl}/v1/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: paid.token, type: 'impression', eventId: 'event-impression-0001' }),
    });
    assert.deepEqual(await json(impression), { accepted: true, duplicate: false });
    const duplicateImpression = await fetch(`${registry.baseUrl}/v1/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: paid.token, type: 'impression', eventId: 'event-impression-0002' }),
    });
    assert.deepEqual(await json(duplicateImpression), { accepted: true, duplicate: true });

    const beforeClickMetrics = await json<{ clicks: number; spentCents: number }>(await fetch(`${registry.baseUrl}/v1/admin/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }));
    assert.equal(beforeClickMetrics.clicks, 0);
    assert.equal(beforeClickMetrics.spentCents, 0);

    const tamperedToken = `${paid.token.slice(0, -1)}${paid.token.endsWith('a') ? 'b' : 'a'}`;
    const invalidEvent = await fetch(`${registry.baseUrl}/v1/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tamperedToken, type: 'hide', eventId: 'event-invalid-0001' }),
    });
    assert.equal(invalidEvent.status, 401);

    const clickResponse = await fetch(paid.url, { redirect: 'manual' });
    assert.equal(clickResponse.status, 302);
    assert.equal(clickResponse.headers.get('location'), campaignInput.url);
    const replayResponse = await fetch(paid.url, { redirect: 'manual' });
    assert.equal(replayResponse.status, 410);

    const metrics = await json<{
      campaigns: number; decisions: number; impressions: number; clicks: number; spentCents: number;
    }>(await fetch(`${registry.baseUrl}/v1/admin/metrics`, { headers: { Authorization: `Bearer ${adminToken}` } }));
    assert.equal(metrics.campaigns, 1);
    assert.equal(metrics.decisions, 3);
    assert.equal(metrics.impressions, 1);
    assert.equal(metrics.clicks, 1);
    assert.equal(metrics.spentCents, 25);

    const campaigns = await json<{ items: Campaign[] }>(await fetch(`${registry.baseUrl}/v1/admin/campaigns`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }));
    assert.equal(campaigns.items[0]?.spentCents, 25);
  } finally {
    await registry.close();
  }
});

test('HTTP boundary enforces exact CORS, body limits, campaign URL checks, disabled admin and rate limiting', async () => {
  const registry = await startRegistry({ dev: false, seed: false, allowedOrigins: ['https://console.example'] });
  try {
    const allowed = await fetch(`${registry.baseUrl}/health`, { headers: { Origin: 'https://console.example' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://console.example');

    const denied = await fetch(`${registry.baseUrl}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://console.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);

    const malformed = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: '{bad json',
    });
    assert.equal(malformed.status, 400);

    const oversized = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);

    const invalidCampaign = await fetch(`${registry.baseUrl}/v1/admin/campaigns`, {
      method: 'POST', headers: operatorHeaders(), body: JSON.stringify({
        name: 'Invalid destination', sponsor: 'Invalid', text: 'Invalid target.', url: 'http://127.0.0.1/private',
        categories: ['development'], active: false, budgetCents: 0, cpcCents: 0, dailyCap: 0,
        startsAt: new Date(Date.now() - 1_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    assert.equal(invalidCampaign.status, 422);

    const responses = await Promise.all(Array.from({ length: 301 }, () => fetch(`${registry.baseUrl}/v1/search`)));
    assert.ok(responses.some(response => response.status === 429));
    const limited = responses.find(response => response.status === 429)!;
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  } finally {
    await registry.close();
  }

  const disabled = await startRegistry({ dev: false, seed: false, token: '' });
  try {
    const response = await fetch(`${disabled.baseUrl}/v1/admin/skills`, { headers: { Authorization: 'Bearer anything' } });
    assert.equal(response.status, 404);
    assert.equal((await json<{ error: { code: string } }>(response)).error.code, 'admin_disabled');
  } finally {
    await disabled.close();
  }

  const proxied = await startRegistry({ dev: false, seed: false, trustedProxies: ['127.0.0.1'] });
  try {
    const responses = await Promise.all(Array.from({ length: 301 }, (_, index) => fetch(`${proxied.baseUrl}/v1/search`, {
      headers: { 'X-Forwarded-For': `198.51.100.${index % 250}, 203.0.113.${Math.floor(index / 250) + 1}` },
    })));
    assert.ok(responses.every(response => response.status === 200), 'Explicit trusted proxy mode must rate-limit distinct forwarded clients independently');
  } finally {
    await proxied.close();
  }
});

test('oversized JSON returns 413 reliably and bounds unfinished fixed-length and chunked uploads', { timeout: 15_000 }, async () => {
  const registry = await startRegistry({ dev: false, seed: false });
  const body = JSON.stringify({ payload: 'x'.repeat(1024 * 1024) });
  try {
    // Exercise the original upload/early-close race across fresh and reused
    // connections rather than allowing a passing retry to hide ECONNRESET.
    for (let index = 0; index < 24; index += 1) {
      const response = await fetch(`${registry.baseUrl}/v1/admin/skills`, {
        method: 'POST', headers: operatorHeaders(), body,
      });
      assert.equal(response.status, 413);
      assert.equal((await json<{ error: { code: string } }>(response)).error.code, 'body_too_large');
    }

    const upload = (chunk: string, complete: boolean, declaredLength?: number) => new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${registry.baseUrl}/v1/admin/skills`, {
        method: 'POST',
        headers: { ...operatorHeaders(), ...(declaredLength ? { 'Content-Length': declaredLength } : {}) },
      }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode!));
        response.once('error', reject);
      });
      request.once('error', reject);
      request.setTimeout(5_000, () => request.destroy(new Error('Oversized upload was not bounded')));
      if (complete) request.end(chunk);
      else request.write(chunk);
    });

    assert.equal(await upload(body, true), 413, 'Complete chunked bodies receive the same structured rejection');
    assert.equal(await upload('x', false, 2 * 1024 * 1024), 413, 'An oversized declared body cannot reserve an idle connection');
    assert.equal(await upload(body, false), 413, 'An oversized chunked body is rejected even without its final chunk');
    assert.equal(await upload('x'.repeat(2 * 1024 * 1024 + 1), false), 413, 'The drain byte cap rejects continuously supplied bodies before their end');

    const healthy = await fetch(`${registry.baseUrl}/health`);
    assert.equal(healthy.status, 200);
  } finally {
    await registry.close();
  }
});

test('SQLite catalog and Ed25519 trust key persist across restart and development seeding is idempotent', async () => {
  const first = await startRegistry();
  const dataDir = first.dataDir;
  const firstKey = await json<PublicKeyInfo>(await fetch(`${first.baseUrl}/v1/keys`));
  const firstCatalog = verifyPayload(
    await json<Signed<Catalog>>(await fetch(`${first.baseUrl}/v1/catalog`)),
    firstKey,
  );
  await first.close(false);

  const second = await startRegistry({ dataDir });
  try {
    const secondKey = await json<PublicKeyInfo>(await fetch(`${second.baseUrl}/v1/keys`));
    const secondCatalog = verifyPayload(
      await json<Signed<Catalog>>(await fetch(`${second.baseUrl}/v1/catalog`)),
      secondKey,
    );
    assert.deepEqual(secondKey, firstKey);
    assert.equal(secondCatalog.skills.length, firstCatalog.skills.length);
    assert.deepEqual(
      secondCatalog.skills.map(skill => `${skill.id}@${skill.version}`),
      firstCatalog.skills.map(skill => `${skill.id}@${skill.version}`),
    );
  } finally {
    await second.close();
  }
});

test('semantic version ordering handles stable, prerelease, hyphenated and large numeric identifiers', () => {
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.ok(compareVersions('1.0.0-alpha-beta.2', '1.0.0-alpha-beta.1') > 0);
  assert.ok(compareVersions('999999999999999999999.0.0', '999999999999999999998.999.999') > 0);
  assert.equal(compareVersions('2.3.4+build.9', '2.3.4+build.10'), 0);
});
