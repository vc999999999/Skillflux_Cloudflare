import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRunRecord } from '../src/publish.js';
import { seededShuffle } from '../src/runner/order.js';
import { runBenchmark } from '../src/runner/run.js';
import { isInfrastructureError, parseStream } from '../src/runner/stream.js';
import { RunRecord } from '../src/schema.js';
import { summarizeSkill } from '../src/summarize.js';

const line = (event: unknown) => JSON.stringify(event);

describe('stream-json parsing', () => {
  const init = { type: 'system', subtype: 'init', model: 'claude-x', claude_code_version: '2.1.0', tools: ['Read', 'Skill'], skills: ['xlsx'] };
  const result = { type: 'result', subtype: 'success', is_error: false, duration_ms: 1000, duration_api_ms: 900, num_turns: 3, total_cost_usd: 0.05, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 }, modelUsage: { 'claude-x-20260101': {} } };

  it('detects a Skill tool call, its turn, cost, tokens and resolved models', () => {
    const text = [line(init), line({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }), line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'xlsx' } }] } }), 'not json', line(result)].join('\n');
    const summary = parseStream(text, 'xlsx');
    expect(summary.triggered).toBe(true);
    expect(summary.firstTriggerTurn).toBe(2);
    expect(summary.init).toMatchObject({ version: '2.1.0', skillsListed: ['xlsx'] });
    expect(summary.result).toMatchObject({ costUsd: 0.05, numTurns: 3, tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, modelsResolved: ['claude-x-20260101'] });
    expect(summary.malformedLines).toBe(1);
  });

  it('accepts legacy and plugin-qualified invocations but not other skills', () => {
    const call = (input: object) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input }] } });
    expect(parseStream(call({ command: 'xlsx' }), 'xlsx').triggered).toBe(true);
    expect(parseStream(call({ skill: 'anthropic:xlsx' }), 'xlsx').triggered).toBe(true);
    expect(parseStream(call({ skill: 'pdf' }), 'xlsx').triggered).toBe(false);
  });

  it('reports unknown isolation when init lists no skills, and classifies errors', () => {
    expect(parseStream(line({ type: 'system', subtype: 'init', tools: [] }), 'xlsx').init.skillsListed).toBeNull();
    const overloaded = parseStream(line({ ...result, is_error: true, subtype: 'error_during_execution', result: 'API Error: 529 overloaded' }), 'xlsx');
    expect(isInfrastructureError(overloaded, '')).toBe(true);
    const maxTurns = parseStream(line({ ...result, is_error: true, subtype: 'error_max_turns' }), 'xlsx');
    expect(isInfrastructureError(maxTurns, '')).toBe(false);
    expect(isInfrastructureError(parseStream('', 'xlsx'), 'crashed')).toBe(true);
  });
});

describe('trial ordering', () => {
  it('is reproducible for a seed and interleaves arms', () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ arm: index < 10 ? 'with' : 'without', index }));
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect(seededShuffle(items, 42)).not.toEqual(seededShuffle(items, 7));
    expect(seededShuffle(items, 42).slice(0, 10).some(item => item.arm === 'without')).toBe(true);
  });
});

describe('end-to-end dry run with the fake claude', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'skillflux-e2e-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('runs, grades and summarizes a skill with verified isolation', async () => {
    const skillDir = join(root, 'skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: xlsx\ndescription: test double\n---\nbody\n');
    const runDir = await runBenchmark({
      skills: ['anthropics-skills-xlsx'], model: 'fake-model', repeats: 2, concurrency: 2, budgetUsd: 100, seed: 1,
      allowHost: false, dryRun: true, runsDir: root, resolveSkillDir: async () => skillDir,
    });
    const record = await buildRunRecord(runDir, { supersedes: null, allowDryRun: true, publishedAt: '2026-10-29' });
    expect(RunRecord.parse(record)).toBeTruthy();
    const result = record.skills[0]!;
    // Fake claude solves the task only when the skill is installed.
    expect(result.pooled.with).toMatchObject({ n: 6, passes: 6, triggered: 6 });
    expect(result.pooled.without).toMatchObject({ n: 6, passes: 0, triggered: 0 });
    expect(result.pooled.comparison.verdict).toBe('improves');
    expect(result.falseTrigger).toMatchObject({ n: 2, triggered: 2 });
    expect(record.trials.every(trial => trial.status === 'ok')).toBe(true);
    expect(record.totals.trials).toBe(14);
    // The published summary is reproducible from its trials.
    const tasks = result.tasks.map(({ taskId, taskVersion, taskSha256, kind, title, prompt, checks }) => ({ taskId, taskVersion, taskSha256, kind, title, prompt, checks }));
    expect(summarizeSkill(result.skillId, result.commitSha, tasks, record.trials)).toEqual(result);
  }, 120_000);

  it('refuses to publish dry runs or to run outside a container', async () => {
    await expect(runBenchmark({ model: 'm', repeats: 1, concurrency: 1, budgetUsd: 1, seed: 1, allowHost: false, dryRun: false, runsDir: root }))
      .rejects.toThrow(/outside a container/);
  });
});
