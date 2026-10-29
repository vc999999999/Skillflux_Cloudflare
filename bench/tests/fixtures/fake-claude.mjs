#!/usr/bin/env node
// Deterministic stand-in for `claude -p --output-format stream-json` used by
// dry runs and tests. When the skill is installed it "uses" it and writes the
// task's reference solution; without it, it writes nothing, so the grader fails.
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('0.0.0-fake (Claude Code)\n'); process.exit(0); }

const cwd = process.cwd();
const skillsDir = join(cwd, '.claude', 'skills');
const skills = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
const name = process.env.SKILLFLUX_FAKE_SKILL;
const reference = process.env.SKILLFLUX_FAKE_REFERENCE;
const model = args[args.indexOf('--model') + 1] ?? 'fake-model';
const emit = event => process.stdout.write(`${JSON.stringify(event)}\n`);

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  emit({ type: 'system', subtype: 'init', model, claude_code_version: '0.0.0-fake', tools: ['Read', 'Write', 'Bash', 'Skill'], skills, slash_commands: [] });
  const installed = name && skills.includes(name);
  if (installed) {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: name } }] } });
    if (reference && existsSync(reference)) cpSync(reference, cwd, { recursive: true, force: true });
  }
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: `done (${input.length} chars of prompt)` }] } });
  emit({
    type: 'result', subtype: 'success', is_error: false,
    duration_ms: installed ? 42000 : 30000, duration_api_ms: installed ? 40000 : 28000, num_turns: installed ? 4 : 3,
    total_cost_usd: installed ? 0.12 : 0.08,
    usage: { input_tokens: 1200, output_tokens: installed ? 900 : 600, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800 },
    modelUsage: { [model]: {} },
  });
});
