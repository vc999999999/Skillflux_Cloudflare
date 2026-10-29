// Parses Claude Code's `--output-format stream-json` transcript: one JSON
// object per line. Field names follow the headless-mode output; anything
// missing is reported as null rather than guessed.

export interface StreamSummary {
  init: { model: string | null; version: string | null; skillsListed: string[] | null; tools: string[] };
  triggered: boolean;
  skillInvocations: number;
  firstTriggerTurn: number | null;
  /** Fallback signal: the agent read the SKILL.md directly instead of using the Skill tool. */
  readSkillFile: boolean;
  result: {
    subtype: string | null;
    isError: boolean;
    durationMs: number | null;
    durationApiMs: number | null;
    numTurns: number;
    costUsd: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    modelsResolved: string[];
    errorText: string | null;
  } | null;
  malformedLines: number;
}

type Json = Record<string, unknown>;
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function invokedSkill(input: Json, skillName: string): boolean {
  const value = typeof input.skill === 'string' ? input.skill : typeof input.command === 'string' ? input.command : '';
  // Plugin skills appear as "plugin:name"; slash forms as "/name".
  const bare = value.replace(/^\//, '').split(':').at(-1)!;
  return bare === skillName;
}

function listedSkills(init: Json): string[] | null {
  const skills = asArray(init.skills).map(item => typeof item === 'string' ? item : typeof (item as Json)?.name === 'string' ? (item as Json).name as string : null).filter((item): item is string => Boolean(item));
  const commands = asArray(init.slash_commands).filter((item): item is string => typeof item === 'string');
  if (!('skills' in init) && !('slash_commands' in init)) return null;
  return [...new Set([...skills, ...commands].map(item => item.replace(/^\//, '').split(':').at(-1)!))];
}

export function parseStream(text: string, skillName: string): StreamSummary {
  const summary: StreamSummary = {
    init: { model: null, version: null, skillsListed: null, tools: [] },
    triggered: false, skillInvocations: 0, firstTriggerTurn: null, readSkillFile: false, result: null, malformedLines: 0,
  };
  let assistantTurns = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event: Json;
    try { event = JSON.parse(line) as Json; } catch { summary.malformedLines += 1; continue; }
    if (event.type === 'system' && event.subtype === 'init') {
      summary.init = {
        model: typeof event.model === 'string' ? event.model : null,
        version: typeof event.claude_code_version === 'string' ? event.claude_code_version : typeof event.version === 'string' ? event.version : null,
        skillsListed: listedSkills(event),
        tools: asArray(event.tools).filter((item): item is string => typeof item === 'string'),
      };
    } else if (event.type === 'assistant') {
      assistantTurns += 1;
      for (const block of asArray((event.message as Json | undefined)?.content)) {
        const part = block as Json;
        if (part?.type !== 'tool_use') continue;
        const input = (part.input ?? {}) as Json;
        if (part.name === 'Skill' && invokedSkill(input, skillName)) {
          summary.skillInvocations += 1;
          if (!summary.triggered) { summary.triggered = true; summary.firstTriggerTurn = assistantTurns; }
        }
        if (part.name === 'Read' && typeof input.file_path === 'string' && input.file_path.includes(`/.claude/skills/${skillName}/SKILL.md`)) summary.readSkillFile = true;
      }
    } else if (event.type === 'result') {
      const usage = (event.usage ?? {}) as Json;
      const models = Object.keys((event.modelUsage ?? {}) as Json).sort();
      summary.result = {
        subtype: typeof event.subtype === 'string' ? event.subtype : null,
        isError: event.is_error === true,
        durationMs: asNumber(event.duration_ms),
        durationApiMs: asNumber(event.duration_api_ms),
        numTurns: asNumber(event.num_turns) ?? assistantTurns,
        costUsd: asNumber(event.total_cost_usd) ?? 0,
        tokens: {
          input: asNumber(usage.input_tokens) ?? 0,
          output: asNumber(usage.output_tokens) ?? 0,
          cacheRead: asNumber(usage.cache_read_input_tokens) ?? 0,
          cacheWrite: asNumber(usage.cache_creation_input_tokens) ?? 0,
        },
        modelsResolved: models,
        errorText: typeof event.result === 'string' && event.is_error === true ? event.result.slice(0, 500) : null,
      };
    }
  }
  return summary;
}

/** Errors that say nothing about the skill: retry them instead of counting them. */
export function isInfrastructureError(summary: StreamSummary, stderr: string): boolean {
  if (!summary.result) return true;
  if (!summary.result.isError) return false;
  if (summary.result.subtype === 'error_max_turns') return false;
  const text = `${summary.result.errorText ?? ''}\n${stderr}`;
  return /\b(?:429|500|502|503|504|529)\b|rate.?limit|overloaded|ECONNRESET|ETIMEDOUT|socket hang up|network error|API Error/i.test(text);
}
