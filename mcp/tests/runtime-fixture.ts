import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { bundleDigest, contentHash, sha256, signPayload, type AdDecision, type Bundle, type Host, type Revocations, type SkillDetail, type SkillVersionSummary } from '../src/shared.js';
import { issueDecisionToken, verifyDecisionToken } from '../src/registry/crypto.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

/** Synthetic signed HTTP fixture only. It represents protocol states, never real human testing. */
export async function fixtureRegistry(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-runtime-fixture-'));
  const project = join(directory, 'project');
  await mkdir(project);
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const key = { keyId: 'synthetic-runtime-fixture', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
  const bundles = new Map<string, Bundle>();
  const requests: string[] = [];
  const revoked: Revocations['items'] = [];
  const adEvents: { eventId: string; type: string; token: string; reason?: string }[] = [];
  let offline = false;
  let failBundles = false;
  let ads = false;
  let dropEventResponses = false;
  function add(version: string, options: { id?: string; minClient?: string; hosts?: Host[]; breaking?: boolean; deps?: {id: string; version: string}[] } = {}) {
    const id = options.id ?? 'code-review';
    const text = `---\nname: ${id}\ndescription: Synthetic test fixture\n---\n\n# Code review\n\nSynthetic test fixture version ${version}.\n`;
    const createdAt = new Date().toISOString();
    const bundle: Bundle = { manifest: {
      schema: 'skillflux/v1', id, version, name: 'Synthetic review fixture', description: 'Runtime protocol test fixture only',
      category: 'development', tags: [], hosts: options.hosts ?? ['generic'], publisher: 'Synthetic test fixture (not a person)', license: 'MIT', entry: 'SKILL.md',
      permissions: { network: [], shell: false, secrets: [] }, dependencies: options.deps ?? [],
      files: [{ path: 'SKILL.md', sha256: sha256(text), size: Buffer.byteLength(text) }],
      quality: { automated: { passed: true, checks: ['synthetic fixture'], checkedAt: createdAt }, review: { reviewer: 'Synthetic fixture; not a real evaluation', reviewedAt: createdAt, notes: 'Protocol test state only' } },
      createdAt, release: { notes: `Synthetic release ${version}`, breaking: options.breaking ?? false, minClientVersion: options.minClient ?? '1.0.0', maintainedAt: createdAt, maintainedBy: 'Synthetic fixture' },
    }, files: { 'SKILL.md': text } };
    bundle.manifest.quality.evaluation = { evaluationId: `synthetic-${id}-${version}`, contentHash: contentHash(bundle), testedAt: createdAt, summary: 'Synthetic public proof for protocol tests; not actual human testing', hosts: bundle.manifest.hosts, purposePassed: true, boundaryPassed: true };
    bundles.set(`${id}@${version}`, bundle);
    return bundle;
  }
  function summary(bundle: Bundle): SkillDetail['skill'] {
    const manifest = bundle.manifest;
    const isRevoked = revoked.some(item => item.id === manifest.id && item.version === manifest.version);
    return { ...manifest, status: isRevoked ? 'revoked' : 'approved', qualification: isRevoked ? 'revoked' : 'qualified', digest: bundleDigest(bundle), size: Buffer.byteLength(bundle.files['SKILL.md']) };
  }
  add('1.0.0');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    requests.push(`${req.method} ${url.pathname}`);
    if (offline) { req.socket.destroy(); return; }
    const send = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/v1/keys') return send(key);
    if (url.pathname === '/v1/revocations') return send(signPayload({ items: revoked, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }, privateKey, key.keyId));
    const qualification = /^\/v1\/qualifications\/([a-f0-9]+)$/.exec(url.pathname);
    if (qualification) {
      const bundle = [...bundles.values()].find(item => bundleDigest(item) === qualification[1]);
      if (bundle) return send(signPayload({ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundleDigest(bundle), contentHash: contentHash(bundle), qualification: summary(bundle).qualification, evaluation: bundle.manifest.quality.evaluation, generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }, privateKey, key.keyId));
    }
    const versions = /^\/v1\/skills\/([^/]+)\/versions$/.exec(url.pathname);
    if (versions) {
      const items: SkillVersionSummary[] = [...bundles.values()].filter(bundle => bundle.manifest.id === versions[1]).map(bundle => ({ ...summary(bundle), qualification: summary(bundle).qualification! }));
      return send({ items, total: items.length, offset: 0, limit: 100 });
    }
    const skill = /^\/v1\/skills\/([^/]+)$/.exec(url.pathname);
    if (skill) {
      const bundle = bundles.get(`${skill[1]}@${url.searchParams.get('version') ?? '1.0.0'}`);
      if (bundle) return send({ skill: summary(bundle), manifest: bundle.manifest, content: bundle.files['SKILL.md'], resources: [] });
    }
    const artifact = /^\/v1\/bundles\/([a-f0-9]+)$/.exec(url.pathname);
    if (artifact && !failBundles) {
      const bundle = [...bundles.values()].find(item => bundleDigest(item) === artifact[1]);
      if (bundle) return send(signPayload(bundle, privateKey, key.keyId));
    }
    if (url.pathname === '/v1/ads/decision' && req.method === 'POST' && ads) {
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      const decisionId = randomUUID();
      const decision: AdDecision = { decisionId, campaignId: null, creativeId: 'synthetic-house', disclosure: '广告', text: 'Synthetic fixture advertisement', url: 'https://registry.example/', expiresAt, token: issueDecisionToken(decisionId, expiresAt, privateKey), house: true };
      return send(signPayload(decision, privateKey, key.keyId));
    }
    if (url.pathname === '/v1/events' && req.method === 'POST' && ads) {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw) as { token: string; type: string; eventId: string; reason?: string };
        try {
          verifyDecisionToken(body.token, key.publicKey);
        } catch {
          send({ error: { code: 'invalid_decision_token', message: 'Synthetic fixture rejected the decision token' } }, 401);
          return;
        }
        const duplicate = adEvents.some(event => event.eventId === body.eventId || (body.type === 'impression' && event.type === 'impression' && event.token === body.token));
        adEvents.push({ eventId: body.eventId, type: body.type, token: body.token, ...(body.reason ? { reason: body.reason } : {}) });
        // Simulates a response lost after the server already recorded the event.
        if (dropEventResponses) { req.socket.destroy(); return; }
        send({ accepted: true, duplicate });
      });
      return;
    }
    return send({ error: { code: 'NOT_FOUND', message: 'Synthetic fixture route unavailable' } }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const registry = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { directory, project, registry, add, requests, revoked, bundles, adEvents, offline: (value: boolean) => { offline = value; }, failBundles: (value: boolean) => { failBundles = value; }, enableAds: (value: boolean) => { ads = value; }, dropEvents: (value: boolean) => { dropEventResponses = value; } };
}

export async function installedRuntime(t: TestContext) {
  const fixture = await fixtureRegistry(t);
  await initializeProject({ projectRoot: fixture.project, registry: fixture.registry, host: 'generic', cliPath: process.execPath, preauthorizeReviewedText: true });
  const runtime = await SkillFluxRuntime.open(fixture.project);
  await runtime.installPlan((await runtime.createPlan('code-review')).id);
  return { ...fixture, runtime };
}
