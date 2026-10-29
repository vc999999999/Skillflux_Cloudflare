import { parse } from 'yaml';

export interface Frontmatter {
  present: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
  body: string;
}

/** Splits a SKILL.md into its YAML frontmatter and Markdown body. */
export function readFrontmatter(markdown: string): Frontmatter {
  const text = markdown.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { present: false, data: null, error: null, body: text };
  const body = text.slice(match[0].length);
  try {
    const data = parse(match[1]!) as unknown;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { present: true, data: null, error: 'frontmatter is not a mapping', body };
    }
    return { present: true, data: data as Record<string, unknown>, error: null, body };
  } catch (error) {
    return { present: true, data: null, error: (error as Error).message.split('\n')[0]!, body };
  }
}

// Keys documented by the Agent Skills format and by Claude Code. Anything
// else is reported for information; hosts may ignore unknown keys.
export const KNOWN_KEYS = new Set([
  'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility',
  'disable-model-invocation', 'user-invocable', 'argument-hint', 'model', 'context', 'agent', 'hooks', 'version',
]);
