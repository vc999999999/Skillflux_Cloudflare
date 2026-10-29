// L1 static health check. Pure: takes files and repository facts, returns
// findings. No model calls and no network access happen here.
import { createHash } from 'node:crypto';
import { extname, posix } from 'node:path';
import type { HealthCheck, HealthRecord } from '../schema.js';
import { KNOWN_KEYS, readFrontmatter } from './frontmatter.js';
import { deniedExtensions, matchPatterns, matchSecrets, scriptDestructivePatterns, scriptNetworkPatterns, unsafeInstructionPatterns } from './risk-patterns.js';
import { approxTokens } from './tokens.js';

// Bump on any change to a check, its threshold or its wording.
export const CHECKER_VERSION = '1.0.0';

export const LIMITS = {
  nameMaxChars: 64,
  descriptionMaxChars: 1024,
  descriptionMinChars: 50,
  bodyTokensWarn: 5000,
  bodyLinesWarn: 500,
  staleDays: 365,
} as const;

/** Every check id with its meaning, rendered on the methodology page. */
export const CHECK_REGISTRY: Array<{ id: string; en: string; zh: string }> = [
  { id: 'skillmd.present', en: 'A SKILL.md file exists at the skill root.', zh: 'Skill 根目录存在 SKILL.md。' },
  { id: 'frontmatter.parse', en: 'SKILL.md starts with YAML frontmatter that parses as a mapping.', zh: 'SKILL.md 以可解析的 YAML frontmatter 开头。' },
  { id: 'frontmatter.name', en: `name is present, at most ${LIMITS.nameMaxChars} characters, lowercase letters, digits and hyphens.`, zh: `name 存在，不超过 ${LIMITS.nameMaxChars} 个字符，只含小写字母、数字和连字符。` },
  { id: 'frontmatter.nameMatchesDir', en: 'name matches the directory that contains SKILL.md.', zh: 'name 与 SKILL.md 所在目录名一致。' },
  { id: 'frontmatter.description', en: `description is present and at most ${LIMITS.descriptionMaxChars} characters; under ${LIMITS.descriptionMinChars} is a warning.`, zh: `description 存在且不超过 ${LIMITS.descriptionMaxChars} 个字符；少于 ${LIMITS.descriptionMinChars} 个字符给出警告。` },
  { id: 'frontmatter.descriptionTrigger', en: 'description says when to use the skill ("use when…", "when the user…").', zh: 'description 说明了何时使用（如 "use when…"、"当用户…"）。' },
  { id: 'frontmatter.descriptionVoice', en: 'description is written in the third person and contains no XML tags.', zh: 'description 使用第三人称，且不含 XML 标签。' },
  { id: 'frontmatter.unknownKeys', en: 'Frontmatter keys outside the documented set (information only).', zh: '文档未定义的 frontmatter 字段（仅提示）。' },
  { id: 'body.tokensApprox', en: `Approximate token count of the SKILL.md body; above ${LIMITS.bodyTokensWarn} is a warning.`, zh: `SKILL.md 正文的近似 token 数；超过 ${LIMITS.bodyTokensWarn} 给出警告。` },
  { id: 'body.lines', en: `Line count of the SKILL.md body; above ${LIMITS.bodyLinesWarn} is a warning.`, zh: `SKILL.md 正文行数；超过 ${LIMITS.bodyLinesWarn} 行给出警告。` },
  { id: 'refs.brokenLinks', en: 'Relative links in SKILL.md point to files that exist.', zh: 'SKILL.md 中的相对链接指向存在的文件。' },
  { id: 'files.inventory', en: 'Number and total size of files in the skill directory (information only).', zh: 'Skill 目录中的文件数与总大小（仅提示）。' },
  { id: 'files.binary', en: 'No executables or archives (.exe, .zip, .jar, …) are bundled.', zh: '没有打包可执行文件或压缩包（.exe、.zip、.jar 等）。' },
  { id: 'scripts.present', en: 'Bundled scripts the agent may run (information only).', zh: '附带的、Agent 可能执行的脚本（仅提示）。' },
  { id: 'scripts.network', en: 'Scripts that call the network (information only).', zh: '会访问网络的脚本（仅提示）。' },
  { id: 'scripts.destructive', en: 'Scripts with destructive commands such as rm -rf, sudo or chmod 777.', zh: '含 rm -rf、sudo、chmod 777 等破坏性命令的脚本。' },
  { id: 'secrets.scan', en: 'No strings that look like private keys or API tokens.', zh: '没有疑似私钥或 API token 的字符串。' },
  { id: 'instructions.risk', en: 'No instructions to override prior instructions, exfiltrate secrets or bypass safety controls.', zh: '没有要求覆盖先前指令、外传密钥或绕过安全控制的指令。' },
  { id: 'license.detected', en: 'A license is declared in frontmatter, the skill directory or the repository.', zh: '在 frontmatter、Skill 目录或仓库中声明了许可证。' },
  { id: 'repo.activity', en: `The skill path changed within ${LIMITS.staleDays} days of the check, and the repository is not archived.`, zh: `Skill 路径在检查前 ${LIMITS.staleDays} 天内有更新，且仓库未归档。` },
  { id: 'pinned.drift', en: 'Whether upstream changed the skill after the pinned commit (information only).', zh: '钉定版本之后上游是否改动了该 Skill（仅提示）。' },
];

export interface SkillFile { path: string; bytes: number; content: Buffer }

export interface HealthInput {
  dirName: string;
  files: SkillFile[];
  // Paths of files elsewhere in the repository, relative to the skill directory's parent chain.
  repoFiles: Set<string>;
  skillPath: string;
  repoLicenseFile: string | null;
  repoLicenseSpdx: string | null;
  archived: boolean | null;
  lastCommitAt: string | null;
  commitsSincePin: number | null;
  checkedAt: string;
}

export interface HealthResult {
  checks: HealthCheck[];
  metrics: HealthRecord['metrics'];
  flags: HealthRecord['flags'];
  license: { spdx: string | null; raw: string | null; file: string | null };
  name: string | null;
  description: string | null;
}

const scriptExtensions = new Set(['.py', '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.rb', '.ps1', '.pl', '.php']);

function isText(file: SkillFile): boolean {
  return !file.content.includes(0);
}

function check(id: string, status: HealthCheck['status'], value: HealthCheck['value'], detail: string): HealthCheck {
  return { id, status, value, detail };
}

export function runHealthChecks(input: HealthInput): HealthResult {
  const checks: HealthCheck[] = [];
  const flags = new Set<HealthRecord['flags'][number]>();
  const skillMd = input.files.find(file => file.path === 'SKILL.md');
  const textFiles = input.files.filter(isText);

  checks.push(skillMd ? check('skillmd.present', 'pass', true, 'SKILL.md found') : check('skillmd.present', 'fail', false, 'no SKILL.md at the skill root'));
  const front = readFrontmatter(skillMd ? skillMd.content.toString('utf8') : '');
  const data = front.data ?? {};
  if (!front.present) checks.push(check('frontmatter.parse', 'fail', false, 'no YAML frontmatter block'));
  else if (front.error) checks.push(check('frontmatter.parse', 'fail', false, front.error));
  else checks.push(check('frontmatter.parse', 'pass', true, 'frontmatter parsed'));

  const name = typeof data.name === 'string' ? data.name.trim() : null;
  if (!name) checks.push(check('frontmatter.name', 'fail', null, 'name is missing'));
  else if (name.length > LIMITS.nameMaxChars || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) checks.push(check('frontmatter.name', 'warn', name, 'name should be lowercase letters, digits and hyphens, at most 64 characters'));
  else checks.push(check('frontmatter.name', 'pass', name, 'valid name'));
  if (name) checks.push(name === input.dirName
    ? check('frontmatter.nameMatchesDir', 'pass', true, 'name matches its directory')
    : check('frontmatter.nameMatchesDir', 'warn', false, `name "${name}" differs from directory "${input.dirName}"`));

  const description = typeof data.description === 'string' ? data.description.trim() : null;
  const descriptionChars = description ? [...description].length : 0;
  if (!description) checks.push(check('frontmatter.description', 'fail', 0, 'description is missing'));
  else if (descriptionChars > LIMITS.descriptionMaxChars) checks.push(check('frontmatter.description', 'fail', descriptionChars, `description exceeds ${LIMITS.descriptionMaxChars} characters`));
  else if (descriptionChars < LIMITS.descriptionMinChars) checks.push(check('frontmatter.description', 'warn', descriptionChars, 'description is very short; hosts use it to decide when to load the skill'));
  else checks.push(check('frontmatter.description', 'pass', descriptionChars, `${descriptionChars} characters`));
  if (description) {
    // Any stated condition counts: "use it when…", "before…", "TRIGGER:", "when building…", "适用于…".
    const trigger = /\b(?:use|invoke|apply|load)\b[^.\n]{0,30}\b(?:when|whenever|for|before|after|if|to)\b|\bwhen(?:ever)?\b|\btrigger|\bif the user\b|适用于|当用户|在用户|使用场景|使用时机|触发/i.test(description);
    checks.push(trigger
      ? check('frontmatter.descriptionTrigger', 'pass', true, 'states when to use the skill')
      : check('frontmatter.descriptionTrigger', 'warn', false, 'does not say when the skill should be used'));
    const problems = [
      /<\/?[a-z][\w-]*[^>]*>/i.test(description) ? 'contains XML tags' : '',
      /^(?:I|I'm|I am|You|You can|We)\b/.test(description) ? 'written in the first or second person' : '',
    ].filter(Boolean);
    checks.push(problems.length
      ? check('frontmatter.descriptionVoice', 'warn', false, problems.join('; '))
      : check('frontmatter.descriptionVoice', 'pass', true, 'third person, no XML'));
  }
  const unknown = Object.keys(data).filter(key => !KNOWN_KEYS.has(key)).sort();
  checks.push(check('frontmatter.unknownKeys', 'info', unknown.length ? unknown.join(', ') : null, unknown.length ? `${unknown.length} undocumented key(s)` : 'none'));

  const bodyTokensApprox = approxTokens(front.body);
  const bodyLines = front.body ? front.body.replace(/\n$/, '').split('\n').length : 0;
  checks.push(check('body.tokensApprox', bodyTokensApprox > LIMITS.bodyTokensWarn ? 'warn' : 'pass', bodyTokensApprox, bodyTokensApprox > LIMITS.bodyTokensWarn ? 'large body; consider moving detail into referenced files' : 'within budget'));
  checks.push(check('body.lines', bodyLines > LIMITS.bodyLinesWarn ? 'warn' : 'pass', bodyLines, `${bodyLines} lines`));

  const present = new Set(input.files.map(file => file.path));
  const broken: string[] = [];
  for (const match of front.body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = match[1]!;
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(raw)) continue;
    let target = decodeURIComponent(raw.split('#')[0]!.split('?')[0]!);
    if (!target) continue;
    target = posix.normalize(target);
    if (target.startsWith('../')) {
      const fromRoot = posix.normalize(posix.join(input.skillPath, target));
      if (!input.repoFiles.has(fromRoot) && ![...input.repoFiles].some(file => file.startsWith(`${fromRoot}/`))) broken.push(raw);
    } else if (!present.has(target) && ![...present].some(file => file.startsWith(`${target.replace(/\/$/, '')}/`))) broken.push(raw);
  }
  checks.push(broken.length
    ? check('refs.brokenLinks', 'warn', broken.length, `missing: ${[...new Set(broken)].slice(0, 5).join(', ')}`)
    : check('refs.brokenLinks', 'pass', 0, 'all relative links resolve'));

  const totalBytes = input.files.reduce((sum, file) => sum + file.bytes, 0);
  checks.push(check('files.inventory', 'info', input.files.length, `${input.files.length} files, ${totalBytes} bytes`));
  const denied = input.files.filter(file => deniedExtensions.has(extname(file.path).toLowerCase())).map(file => file.path);
  checks.push(denied.length
    ? check('files.binary', 'warn', denied.length, `bundles ${denied.slice(0, 5).join(', ')}`)
    : check('files.binary', 'pass', 0, 'no executables or archives'));

  const scripts = textFiles.filter(file => scriptExtensions.has(extname(file.path).toLowerCase()));
  if (scripts.length) flags.add('executes-code');
  checks.push(check('scripts.present', 'info', scripts.length, scripts.length ? scripts.slice(0, 5).map(file => file.path).join(', ') : 'no scripts'));
  const network = scripts.filter(file => matchPatterns(file.content.toString('utf8'), scriptNetworkPatterns).length);
  if (network.length) flags.add('network-calls');
  checks.push(check('scripts.network', 'info', network.length, network.length ? network.slice(0, 5).map(file => file.path).join(', ') : 'no network calls found'));
  const destructive = scripts.flatMap(file => matchPatterns(file.content.toString('utf8'), scriptDestructivePatterns).map(name => `${file.path} (${name})`));
  if (destructive.length) flags.add('destructive-commands');
  checks.push(destructive.length
    ? check('scripts.destructive', 'warn', destructive.length, destructive.slice(0, 5).join(', '))
    : check('scripts.destructive', 'pass', 0, 'none found'));

  const secrets = textFiles.flatMap(file => matchSecrets(file.content.toString('utf8')).map(name => `${file.path} (${name})`));
  if (secrets.length) flags.add('possible-secret');
  checks.push(secrets.length
    ? check('secrets.scan', 'fail', secrets.length, secrets.slice(0, 5).join(', '))
    : check('secrets.scan', 'pass', 0, 'none found'));
  const risky = textFiles.filter(file => /\.(?:md|txt|markdown)$/i.test(file.path))
    .flatMap(file => matchPatterns(file.content.toString('utf8'), unsafeInstructionPatterns).map(name => `${file.path} (${name})`));
  if (risky.length) flags.add('risky-instructions');
  checks.push(risky.length
    ? check('instructions.risk', 'warn', risky.length, risky.slice(0, 5).join(', '))
    : check('instructions.risk', 'pass', 0, 'none found'));

  const frontLicense = typeof data.license === 'string' ? data.license.trim() : null;
  const dirLicense = input.files.find(file => /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(file.path))?.path ?? null;
  const license = {
    // A frontmatter value that looks like an SPDX id wins. A skill with its own
    // license file may differ from the repository, so its SPDX id stays unknown
    // and readers are pointed at the file.
    spdx: frontLicense && /^[A-Za-z0-9.+-]+$/.test(frontLicense) ? frontLicense : dirLicense ? null : input.repoLicenseSpdx,
    raw: frontLicense,
    file: dirLicense ? posix.join(input.skillPath, dirLicense) : input.repoLicenseFile,
  };
  const licensed = Boolean(frontLicense || dirLicense || input.repoLicenseFile || input.repoLicenseSpdx);
  if (!licensed) flags.add('no-license');
  checks.push(licensed
    ? check('license.detected', 'pass', license.spdx ?? license.raw ?? license.file, frontLicense ? 'declared in frontmatter' : dirLicense ? 'license file in the skill directory' : 'repository license')
    : check('license.detected', 'warn', null, 'no license found; reuse terms are unclear'));

  const ageDays = input.lastCommitAt ? Math.floor((Date.parse(`${input.checkedAt}T00:00:00Z`) - Date.parse(input.lastCommitAt)) / 86_400_000) : null;
  if (input.archived) flags.add('archived-repo');
  if (ageDays !== null && ageDays > LIMITS.staleDays) flags.add('stale');
  checks.push(input.archived
    ? check('repo.activity', 'warn', ageDays, 'repository is archived')
    : ageDays === null ? check('repo.activity', 'info', null, 'last change unknown')
    : ageDays > LIMITS.staleDays ? check('repo.activity', 'warn', ageDays, `skill path unchanged for ${ageDays} days`)
    : check('repo.activity', 'pass', ageDays, `last changed ${ageDays} days before the check`));

  if (input.commitsSincePin) flags.add('upstream-changed');
  checks.push(check('pinned.drift', 'info', input.commitsSincePin, input.commitsSincePin === null ? 'unknown' : input.commitsSincePin ? `${input.commitsSincePin} upstream commit(s) since the pinned commit touch this repository and the skill path` : 'unchanged since the pinned commit'));

  return {
    checks,
    metrics: {
      descriptionChars,
      bodyTokensApprox,
      bodyLines,
      fileCount: input.files.length,
      totalBytes,
      scriptCount: scripts.length,
      lastCommitAt: input.lastCommitAt,
      commitsSincePin: input.commitsSincePin,
    },
    flags: [...flags].sort(),
    license,
    name,
    description,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Identity of a health result. Age in days is excluded: it changes every day
 * while the skill itself has not changed.
 */
export function resultHash(skillId: string, commitSha: string, result: Pick<HealthResult, 'checks' | 'metrics' | 'flags'>): string {
  const checks = result.checks.map(item => item.id === 'repo.activity' ? { ...item, value: null, detail: item.status } : item);
  return createHash('sha256').update(canonical({ checkerVersion: CHECKER_VERSION, skillId, commitSha, checks, metrics: result.metrics, flags: result.flags })).digest('hex');
}
