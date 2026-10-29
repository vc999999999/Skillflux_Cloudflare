// Runs a task's grader in a separate Node process with a timeout, so a
// grader crash or hang marks the trial instead of taking down the run.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { LoadedTask } from '../tasks.js';
import type { Assertion } from './assert.js';

const run = promisify(execFile);

export interface GradeOutcome { passed: boolean; assertions: Assertion[]; error: string | null }

const harness = `
const [entry, workDir] = process.argv.slice(1);
const grader = (await import(entry)).default;
const result = await grader({ workDir });
process.stdout.write(JSON.stringify(result));
`;

export async function gradeWorkspace(task: LoadedTask, workDir: string, _transcriptPath: string | null): Promise<GradeOutcome> {
  if (task.spec.grader.type !== 'script') return { passed: false, assertions: [], error: 'llm-rubric graders are not run automatically' };
  const entry = pathToFileURL(join(task.dir, task.spec.grader.entry)).href;
  try {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', harness, entry, workDir], {
      cwd: workDir, timeout: task.spec.grader.timeoutSec * 1000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? '', HOME: workDir, LANG: 'C.UTF-8' },
    });
    const parsed = JSON.parse(stdout) as { assertions?: Assertion[] };
    const assertions = Array.isArray(parsed.assertions) ? parsed.assertions : [];
    if (!assertions.length) return { passed: false, assertions, error: 'grader returned no assertions' };
    return { passed: assertions.filter(item => item.required).every(item => item.pass), assertions, error: null };
  } catch (error) {
    return { passed: false, assertions: [], error: ((error as { stderr?: string }).stderr || (error as Error).message).trim().slice(0, 300) };
  }
}
