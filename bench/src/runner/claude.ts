// Spawns one headless Claude Code session. The prompt goes in on stdin and
// the environment is an allowlist, so nothing from the operator's shell
// (other keys, config, plugins) reaches the trial.
import { spawn } from 'node:child_process';

export const CLAUDE_FLAGS = (model: string, maxTurns: number, tools: string[]) => [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', model,
  '--max-turns', String(maxTurns),
  // Trials run unattended inside a container; see runner/run.ts for the container check.
  '--permission-mode', 'bypassPermissions',
  '--allowedTools', tools.join(','),
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
];

const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];

export function trialEnv(home: string, configDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASS_THROUGH) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    TMPDIR: home,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...extra,
  };
}

export interface ClaudeRun { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; wallMs: number; error: string | null }

export function runClaude(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; prompt: string; timeoutSec: number }): Promise<ClaudeRun> {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let spawnError: string | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, options.timeoutSec * 1000);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => { spawnError = error.message; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), exitCode: code, timedOut, wallMs: Date.now() - started, error: spawnError });
    });
    child.stdin.end(options.prompt);
  });
}

export async function claudeVersion(bin: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await runClaude(bin, ['--version'], { cwd: process.cwd(), env, prompt: '', timeoutSec: 30 });
  return result.exitCode === 0 ? result.stdout.trim().split(/\s+/)[0] ?? null : null;
}
