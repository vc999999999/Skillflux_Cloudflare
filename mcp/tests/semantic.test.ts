import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticSection, embedQuery, semanticDocFor, stripUrls, tokenize, SEMANTIC_DIMS, SEMANTIC_MODEL, type SemanticSection } from '../src/catalog/semantic.js';
import { searchIndex } from '../src/runtime/validation.js';
import type { CatalogIndexEntry } from '../src/catalog/model.js';

function entry(id: string, over: Partial<CatalogIndexEntry['skill']> = {}): CatalogIndexEntry {
  return {
    skill: {
      id, version: '1.0.0', name: id, description: id, category: 'development', tags: [], hosts: ['generic'],
      publisher: 'test', license: 'MIT', status: 'approved', digest: 'a'.repeat(64), size: 100, entry: 'SKILL.md',
      permissions: { network: [], shell: false, secrets: [] }, dependencies: [], createdAt: '2026-01-01T00:00:00.000Z',
      qualification: 'qualified',
      quality: { automated: { passed: true, checks: [], checkedAt: '2026-01-01T00:00:00.000Z' }, review: { reviewer: 't', reviewedAt: '2026-01-01T00:00:00.000Z', notes: '' } },
      ...over,
    },
    files: [{ path: 'SKILL.md', sha256: 'a'.repeat(64), size: 10 }],
  };
}

const docs = [
  semanticDocFor(
    { id: 'scientific-brainstorming', version: '1.0.0', name: '科研头脑风暴', description: 'Generate research hypotheses and experimental designs for scientific projects.', category: 'research', tags: ['research', 'hypothesis', 'science'] },
    { 'SKILL.md': 'Brainstorm novel research questions, hypotheses and experiment designs with literature grounding.' },
  ),
  semanticDocFor(
    { id: 'landing-page-design', version: '1.0.0', name: '落地页设计', description: 'Design and implement responsive landing pages in the existing frontend stack.', category: 'development', tags: ['web-design', 'frontend'] },
    { 'SKILL.md': 'Inspect the entry route, layout, shared styles before editing. Choose type scale, background, accent.' },
  ),
  semanticDocFor(
    { id: 'code-review', version: '1.0.0', name: 'Code Review', description: 'Review git diffs for correctness, regressions and missing tests.', category: 'development', tags: ['review', 'testing'] },
    { 'SKILL.md': '审查 Git diff 和实现中的正确性、回归与测试缺口。' },
  ),
];

const section: SemanticSection = buildSemanticSection({ docs });

test('semantic section describes its model and covers every doc', () => {
  assert.equal(section.model.kind, SEMANTIC_MODEL);
  assert.equal(section.model.dims, SEMANTIC_DIMS);
  assert.deepEqual(Object.keys(section.skills).sort(), ['code-review@1.0.0', 'landing-page-design@1.0.0', 'scientific-brainstorming@1.0.0']);
});

test('tokenizer strips URLs so source addresses stay metadata', () => {
  const tokens = tokenize('Source code lives at https://github.com/mattpocock/skills and github.com/qingyuna/answer-me-with-html, see docs');
  assert.ok(!tokens.some(token => token.includes('github') && token.includes('com')));
  assert.ok(!tokens.join(' ').includes('answer-me-with-html'));
  assert.ok(tokens.includes('docs'));
  assert.equal(stripUrls('see https://example.com/x done'), 'see   done');
});

test('tokenizer emits CJK unigrams and bigrams', () => {
  const tokens = tokenize('科研头脑风暴');
  assert.ok(tokens.includes('科'));
  assert.ok(tokens.includes('科研'));
  assert.ok(tokens.includes('头脑'));
});

test('a morphology-shifted query semantically surfaces the right skill', () => {
  // "hypothesis" never appears as a keyword substring ("hypotheses" differs),
  // so only the semantic pass can connect the query to the science skill.
  const entries = [entry('scientific-brainstorming', { name: '科研头脑风暴', description: 'Generate research hypotheses and experimental designs for scientific projects.', tags: ['research', 'science'], category: 'research' }),
    entry('landing-page-design', { name: '落地页设计', description: 'Design and implement responsive landing pages in the existing frontend stack.' }),
    entry('code-review', { name: 'Code Review', description: 'Review git diffs for correctness, regressions and missing tests.' })];
  const keywordOnly = searchIndex(entries, { query: 'hypothesis' });
  const hybrid = searchIndex(entries, { query: 'hypothesis', semantic: section });
  assert.equal(keywordOnly.total, 0);
  assert.ok(hybrid.total >= 1);
  assert.equal(hybrid.items[0]!.id, 'scientific-brainstorming');
  assert.match(hybrid.items[0]!.reasons[0]!, /^hybrid keyword=/);
});

test('hybrid search can surface a skill the keyword pass misses entirely', () => {
  // 'novel questions grounding' appear only in the body text, never in the
  // searchable summary (id/name/description/category/tags).
  const entries = [entry('scientific-brainstorming', { name: '科研头脑风暴', description: 'Generate research hypotheses and experimental designs.', category: 'research' }),
    entry('landing-page-design', { name: '落地页设计', description: 'Design and implement responsive landing pages in the existing frontend stack.' })];
  const keywordOnly = searchIndex(entries, { query: 'novel questions grounding' });
  const hybrid = searchIndex(entries, { query: 'novel questions grounding', semantic: section });
  assert.equal(keywordOnly.total, 0);
  assert.ok(hybrid.total >= 1);
  assert.equal(hybrid.items[0]!.id, 'scientific-brainstorming');
});

test('search degrades to keyword-only scoring without a semantic section', () => {
  const entries = [entry('code-review', { description: 'Review git diffs for correctness.' })];
  const result = searchIndex(entries, { query: 'git diffs' });
  assert.equal(result.total, 1);
  assert.match(result.items[0]!.reasons[0]!, /^matched /);
});

test('query embedding is null when no query term has a centroid', () => {
  assert.equal(embedQuery(section, ''), null);
  assert.equal(embedQuery(section, 'zzzzz-unseen-term'), null);
  assert.ok(embedQuery(section, 'research hypotheses'));
});

test('quantized vectors round-trip through the section', () => {
  const queryVector = embedQuery(section, 'research hypotheses science');
  assert.ok(queryVector);
  const norm = Math.sqrt(queryVector!.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 0.01, `query vector should stay normalized, got ${norm}`);
});
