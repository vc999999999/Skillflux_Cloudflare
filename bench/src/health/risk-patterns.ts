// Ported from the archived tool's catalog scanner (mcp/src/catalog/scan.ts at
// tag v1.3.0-tool-final). The tool rejected packages on these hits; the
// health check reports them as findings instead.

export interface RiskPattern {
  name: string;
  pattern: RegExp;
}

export const deniedExtensions = new Set([
  '.7z', '.app', '.bin', '.com', '.dll', '.dmg', '.exe', '.gz',
  '.jar', '.msi', '.node',
  '.so', '.tar', '.tgz', '.wasm', '.xz', '.zip',
]);

export const secretPatterns: RiskPattern[] = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'github-token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'openai-token', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'anthropic-token', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
];

// Tightened for public reporting: the archived tool used broader patterns to
// reject packages, which flagged ordinary technical prose ("the client sends
// the token", "bypass the permission dialog in tests"). Each pattern here
// needs an explicit instruction to do the harmful thing.
export const unsafeInstructionPatterns: RiskPattern[] = [
  { name: 'instruction-override', pattern: /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/i },
  // The bare word "exfiltrate" appears mostly in security prose ("code cannot
  // exfiltrate a credential"), so only a directed send/upload counts.
  { name: 'secret-exfiltration', pattern: /\b(?:upload|send|post|transmit|exfiltrate)\s+(?:the\s+|all\s+|any\s+|your\s+|the user'?s\s+)?(?:secrets?|credentials|private keys?|api keys?|\.env(?: file)?)\b[^\n]{0,40}\b(?:to|into)\s+(?:https?:\/\/|a remote|an external|external|remote|the following)/i },
  // Imperative verb forms only: gerunds ("bypassing safety controls" inside a
  // misuse red-flag list) describe conduct to escalate on, and hyphenated
  // compounds ("disable-model-invocation: true") are configuration keys —
  // neither is an instruction to act.
  { name: 'safety-bypass', pattern: /(?:disable|bypass|evade)(?![\w-])\s+(?:all\s+|any\s+|the\s+|your\s+|its\s+)?(?:safety|guardrails?|content polic\w*|usage polic\w*)/i },
  { name: 'hidden-sponsorship', pattern: /(?:hide|omit|do not disclose)[^\n]{0,80}(?:advertis|sponsor|paid|\u5e7f\u544a|\u8d5e\u52a9)/i },
];

// Script-level signals. These are descriptive flags, not verdicts: a skill
// that calls the network may be doing exactly what it advertises.
export const scriptNetworkPatterns: RiskPattern[] = [
  { name: 'curl-wget', pattern: /\b(?:curl|wget)\s+[^\n]*https?:\/\//i },
  { name: 'js-fetch', pattern: /\bfetch\s*\(\s*['"`]https?:/ },
  { name: 'python-requests', pattern: /\b(?:requests|httpx|urllib\.request)\.(?:get|post|put|request|urlopen)\s*\(/ },
];

export const scriptDestructivePatterns: RiskPattern[] = [
  { name: 'rm-rf', pattern: /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i },
  { name: 'sudo', pattern: /(?:^|[\s;&|])sudo\s+/m },
  { name: 'chmod-777', pattern: /\bchmod\s+(?:-R\s+)?777\b/ },
  { name: 'force-push', pattern: /\bgit\s+push\s+[^\n]*--force\b/ },
];

// Documentation is full of placeholder credentials ("ghp_your_token_here").
const placeholder = /your|example|placeholder|x{4,}|dummy|fake|sample|redacted|replace|insert|<|>|\.\.\./i;

/** Secret-looking strings, ignoring obvious placeholders and low-variety filler. */
export function matchSecrets(content: string): string[] {
  const hits = new Set<string>();
  for (const { name, pattern } of secretPatterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of content.matchAll(global)) {
      const value = match[0];
      if (name !== 'private-key' && (placeholder.test(value) || new Set(value).size < 10)) continue;
      hits.add(name);
    }
  }
  return [...hits];
}

export function matchPatterns(content: string, patterns: RiskPattern[]): string[] {
  return patterns.filter(entry => entry.pattern.test(content)).map(entry => entry.name);
}
