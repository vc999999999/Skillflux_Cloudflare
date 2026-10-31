import { describe, expect, it } from 'vitest';
import { extractCandidates, seededShuffle } from '../src/audit/run-audit.js';
import { summarizeAudit, type SourceAuditItem } from '../src/schema.js';

const self = { owner: 'list-owner', repo: 'awesome-skills' };

describe('extractCandidates', () => {
  it('normalizes repository, tree and SKILL.md links and drops the list itself', () => {
    const markdown = [
      '- [a](https://github.com/acme/skills/tree/main/skills/pdf) PDF',
      '- [b](https://github.com/acme/skills/blob/main/skills/xlsx/SKILL.md)',
      '- [c](https://github.com/solo/one-skill)',
      '- [d](https://github.com/acme/skills/blob/main/README.md)',
      '- [self](https://github.com/list-owner/awesome-skills/issues)',
      '- [topic](https://github.com/topics/claude)',
      '- [mirror](https://officialskills.sh/acme/skills/docx)',
      '- dup https://github.com/solo/one-skill',
    ].join('\n');
    expect(extractCandidates(markdown, self)).toEqual([
      { repo: 'https://github.com/acme/skills', linkedPath: 'skills/pdf', linkedName: null },
      { repo: 'https://github.com/acme/skills', linkedPath: 'skills/xlsx', linkedName: null },
      { repo: 'https://github.com/solo/one-skill', linkedPath: null, linkedName: null },
      { repo: 'https://github.com/acme/skills', linkedPath: null, linkedName: null },
    ]);
  });
});

describe('seededShuffle', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    expect(seededShuffle(items, 'a')).toEqual(seededShuffle(items, 'a'));
    expect(seededShuffle(items, 'a')).not.toEqual(seededShuffle(items, 'b'));
    expect([...seededShuffle(items, 'a')].sort((x, y) => x - y)).toEqual(items);
  });
});

describe('summarizeAudit', () => {
  const base: SourceAuditItem = { repo: 'https://github.com/a/b', linkedPath: null, outcome: 'checked', commitSha: 'a'.repeat(40), path: 's', name: 's', counts: { pass: 15, warn: 1, fail: 0, info: 5 }, flags: [], statuses: {}, scriptCount: 0, bodyTokensApprox: 100, licenseSpdx: 'MIT', detail: '' };
  it('counts only checked items for content findings', () => {
    const summary = summarizeAudit([
      { ...base, flags: ['executes-code', 'no-license'], statuses: { 'frontmatter.descriptionTrigger': 'warn' } },
      { ...base, counts: { pass: 10, warn: 0, fail: 2, info: 5 }, statuses: { 'body.tokensApprox': 'warn' } },
      { ...base, outcome: 'no-skill', flags: [], counts: null },
      { ...base, outcome: 'unreachable', flags: [], counts: null, commitSha: null },
    ]);
    expect(summary).toMatchObject({ sampled: 4, checked: 2, noSkill: 1, unreachable: 1, withScripts: 1, noLicense: 1, missingTrigger: 1, overTokenBudget: 1, failingAnyCheck: 1 });
  });
});

describe('skillDirs', () => {
  it('lists SKILL.md directories and skips tests, fixtures, examples and templates', async () => {
    const { skillDirs } = await import('../src/audit/run-audit.js');
    expect(skillDirs(['SKILL.md', 'skills/pdf/SKILL.md', 'tests/golden/x/SKILL.md', 'examples/demo/SKILL.md', 'template/SKILL.md', 'skills/pdf/README.md'])).toEqual(['', 'skills/pdf']);
  });
});
