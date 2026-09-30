import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdDecision } from '../shared.js';
import { SkillFluxError } from './errors.js';
import type { AdSelection, LoadedSkill } from './model.js';
import { atomicWriteText } from './paths.js';
import { assertNoSymlinkPath } from './paths.js';
import { SkillFluxRuntime } from './runtime.js';

const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

export interface ManagedRunOptions {
  command: string;
  args: string[];
  skillId: string;
  resources?: string[];
  category?: string;
  adContext?: 'normal' | 'sensitive' | 'unknown';
  json?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  extraEnv?: Record<string, string>;
}

export interface ManagedRunResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  successfulOutput: boolean;
  advertisement: Pick<AdDecision, 'decisionId' | 'campaignId' | 'disclosure' | 'text' | 'url' | 'house'> | null;
  impressionRecorded: boolean;
  /** 'reported' means the registry confirmed the impression; 'queued' means it is only stored locally for retry; 'unknown' means neither; 'none' means no impression was attempted. */
  impressionStatus: 'reported' | 'queued' | 'unknown' | 'none';
  output?: string;
}

export async function runManaged(runtime: SkillFluxRuntime, options: ManagedRunOptions): Promise<ManagedRunResult> {
  if (!options.command || /[\x00\r\n]/.test(options.command)) throw new SkillFluxError('INVALID_COMMAND', 'Managed run requires one explicit executable followed by an argument array');
  if (options.args.some(argument => argument.includes('\0'))) throw new SkillFluxError('INVALID_ARGUMENT', 'Command arguments cannot contain NUL bytes');
  const output = options.stdout ?? process.stdout;
  const errors = options.stderr ?? process.stderr;
  const invocationId = randomUUID();
  const runRoot = join(runtime.paths.runs, invocationId);
  await assertNoSymlinkPath(runtime.paths.root, runRoot, true);
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(runtime.paths.root, runRoot, false);
  const contextPath = join(runRoot, 'context.md');
  let loaded: LoadedSkill;
  try {
    loaded = await runtime.load(options.skillId, options.resources ?? [], false);
    await atomicWriteText(contextPath, renderContext(loaded), 0o600);
    const child = spawn(options.command, options.args, {
      cwd: runtime.paths.root,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...options.extraEnv,
        SKILLFLUX_CONTEXT_FILE: contextPath,
        SKILLFLUX_INVOCATION_ID: invocationId,
        SKILLFLUX_PROJECT_ROOT: runtime.paths.root,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let hasNonWhitespaceOutput = false;
    let outputBytes = 0;
    const captured: Buffer[] = [];
    const stdoutPump = (async () => {
      for await (const chunkValue of child.stdout) {
      const chunk = chunkValue as Buffer | string;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (/\S/.test(buffer.toString('utf8'))) hasNonWhitespaceOutput = true;
      if (options.json) {
        if (outputBytes <= MAX_CAPTURE_BYTES) captured.push(buffer);
      } else {
        await writeChunk(output, buffer);
      }
      }
    })();
    const stderrPump = (async () => {
      for await (const chunkValue of child.stderr) await writeChunk(errors, chunkValue as Buffer);
    })();
    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (!child.killed) child.kill(signal);
    };
    const onSigint = (): void => forwardSignal('SIGINT');
    const onSigterm = (): void => forwardSignal('SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    const completion = new Promise<[number | null, NodeJS.Signals | null]>((resolveChild, rejectChild) => {
      child.once('error', rejectChild);
      child.once('close', (code, signal) => resolveChild([code, signal]));
    });
    let code: number | null = null;
    let signal: NodeJS.Signals | null = null;
    try {
      [[code, signal]] = await Promise.all([completion, stdoutPump, stderrPump]);
    } catch (error) {
      if (!child.killed) child.kill('SIGTERM');
      throw error;
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
    const exitCode = code ?? 1;
    const successfulOutput = exitCode === 0 && signal === null && hasNonWhitespaceOutput;
    if (options.json && outputBytes > MAX_CAPTURE_BYTES) throw new SkillFluxError('OUTPUT_TOO_LARGE', `Machine-readable managed output exceeds ${MAX_CAPTURE_BYTES} bytes`);
    const answer = options.json ? Buffer.concat(captured).toString('utf8') : undefined;
    let advertisement: ManagedRunResult['advertisement'] = null;
    let impressionRecorded = false;
    let impressionStatus: ManagedRunResult['impressionStatus'] = 'none';
    if (successfulOutput && runtime.policy.adsEnabled) {
      let selection: AdSelection | null = null;
      try {
        selection = await runtime.selectAdvertisement(options.category ?? loaded.manifest.category, loaded.skill.id, options.adContext ?? 'unknown');
        advertisement = publicAd(selection.decision);
      } catch (error) {
        if (isSuppressedAdvertisement(error)) {
          await writeChunk(errors, `\nSkillFlux advertisement suppressed: ${(error as Error).message}\n`);
        } else {
          await writeChunk(errors, `\nSkillFlux advertisement service unavailable; advertisement skipped: ${(error as Error).message}\n`);
        }
      }
      if (!options.json && advertisement) await writeChunk(output, `\n\n${advertisement.disclosure}：${advertisement.text} ${advertisement.url}\n`);
      if (selection && !options.json) {
        try {
          const report = await runtime.recordImpression(selection);
          impressionStatus = report.status;
          impressionRecorded = report.status === 'reported';
          if (report.status === 'queued') {
            await writeChunk(errors, 'SkillFlux rendered the disclosure but the registry was unreachable; the impression event is queued locally and will be retried, not yet confirmed.\n');
          } else if (report.status === 'unknown') {
            await writeChunk(errors, 'SkillFlux rendered the disclosure but the impression event was neither confirmed nor queued.\n');
          }
        } catch (error) {
          impressionStatus = 'unknown';
          await writeChunk(errors, `SkillFlux rendered the disclosure but did not record the impression event: ${(error as Error).message}\n`);
        }
      }
    }
    const result: ManagedRunResult = { exitCode, signal, successfulOutput, advertisement, impressionRecorded, impressionStatus };
    if (answer !== undefined) result.output = answer;
    if (options.json) {
      await writeChunk(output, `${JSON.stringify(result)}\n`);
    }
    return result;
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: string | Uint8Array): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) => {
    const onError = (error: Error): void => {
      cleanup();
      rejectWrite(error);
    };
    const onDrain = (): void => {
      cleanup();
      resolveWrite();
    };
    const cleanup = (): void => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };
    stream.once('error', onError);
    const accepted = stream.write(chunk);
    if (accepted) {
      cleanup();
      resolveWrite();
    } else {
      stream.once('drain', onDrain);
    }
  });
}

function isSuppressedAdvertisement(error: unknown): boolean {
  return error instanceof SkillFluxError && ['ad_suppressed', 'AD_SUPPRESSED', 'ADS_DISABLED', 'SENSITIVE_CONTEXT', 'NO_AD'].includes(error.code);
}

function renderContext(loaded: LoadedSkill): string {
  const sections = [
    '# SkillFlux managed context',
    '',
    `Skill: ${loaded.skill.id}@${loaded.skill.version}`,
    `Publisher: ${loaded.skill.publisher}`,
    `Digest: ${loaded.skill.digest}`,
    '',
    `## Entry: ${loaded.entry.path}`,
    '',
    loaded.entry.content,
  ];
  for (const dependency of loaded.dependencies) {
    sections.push('', `## Dependency: ${dependency.id}@${dependency.version} (${dependency.entry})`, '', dependency.content);
  }
  for (const [path, content] of Object.entries(loaded.resources)) sections.push('', `## Resource: ${path}`, '', content);
  if (loaded.warnings.length) sections.push('', '## Verification warnings', '', ...loaded.warnings.map(warning => `- ${warning}`));
  return `${sections.join('\n')}\n`;
}

function publicAd(decision: AdDecision): ManagedRunResult['advertisement'] {
  return {
    decisionId: decision.decisionId,
    campaignId: decision.campaignId,
    disclosure: decision.disclosure,
    text: decision.text,
    url: decision.url,
    house: decision.house,
  };
}
