// Turns trials into the published summaries. Pure and deterministic: the
// publisher writes its output, and the site validator recomputes it from the
// trials to prove the two agree.
import type { ArmSummary, Comparison, SkillResult, Trial } from './schema.js';
import { iqr, median, newcombe, round, roundInterval, verdict, wilson } from './stats.js';

export interface TaskMeta {
  taskId: string; taskVersion: number; taskSha256: string; kind: 'positive' | 'negative-control';
  title: { en: string; zh: string }; prompt: string; checks: Array<{ en: string; zh: string }>;
}

export function summarizeArm(trials: Trial[]): ArmSummary {
  const graded = trials.filter(trial => trial.status === 'ok' && trial.passed !== null);
  const n = graded.length;
  const passes = graded.filter(trial => trial.passed).length;
  const triggered = graded.filter(trial => trial.triggered).length;
  const durations = graded.map(trial => trial.durationMs);
  const costs = graded.map(trial => trial.costUsd);
  const rounded = (value: number | null, digits = 4) => value === null ? null : round(value, digits);
  return {
    n,
    passes,
    passRate: n ? round(passes / n) : null,
    wilson95: roundInterval(wilson(passes, n)),
    triggered,
    triggerRate: n ? round(triggered / n) : null,
    triggerWilson95: roundInterval(wilson(triggered, n)),
    medianDurationMs: rounded(median(durations), 0),
    iqrDurationMs: roundInterval(iqr(durations), 0),
    medianCostUsd: rounded(median(costs)),
    iqrCostUsd: roundInterval(iqr(costs)),
    medianOutputTokens: rounded(median(graded.map(trial => trial.tokens.output)), 0),
    excluded: {
      timeout: trials.filter(trial => trial.status === 'timeout').length,
      invalid: trials.filter(trial => trial.status === 'invalid').length,
      infra: trials.filter(trial => trial.status === 'infra').length,
    },
  };
}

export function compareArms(withSkill: ArmSummary, withoutSkill: ArmSummary): Comparison {
  if (!withSkill.n || !withoutSkill.n) return { passRateDelta: null, newcombe95: null, verdict: null };
  const interval = newcombe(withSkill.passes, withSkill.n, withoutSkill.passes, withoutSkill.n);
  return {
    passRateDelta: round(withSkill.passes / withSkill.n - withoutSkill.passes / withoutSkill.n),
    newcombe95: roundInterval(interval),
    verdict: verdict(interval),
  };
}

export function summarizeSkill(skillId: string, commitSha: string, tasks: TaskMeta[], trials: Trial[]): SkillResult {
  const mine = trials.filter(trial => trial.skillId === skillId);
  const forTask = (taskId: string, arm: Trial['arm']) => mine.filter(trial => trial.taskId === taskId && trial.arm === arm);
  const results = tasks.map(task => {
    const withSkill = summarizeArm(forTask(task.taskId, 'with'));
    const withoutSkill = task.kind === 'positive' ? summarizeArm(forTask(task.taskId, 'without')) : null;
    return {
      ...task,
      arms: { with: withSkill, without: withoutSkill },
      comparison: withoutSkill ? compareArms(withSkill, withoutSkill) : null,
    };
  });
  const positive = new Set(tasks.filter(task => task.kind === 'positive').map(task => task.taskId));
  const negative = new Set(tasks.filter(task => task.kind === 'negative-control').map(task => task.taskId));
  const pooledWith = summarizeArm(mine.filter(trial => positive.has(trial.taskId) && trial.arm === 'with'));
  const pooledWithout = summarizeArm(mine.filter(trial => positive.has(trial.taskId) && trial.arm === 'without'));
  const controls = summarizeArm(mine.filter(trial => negative.has(trial.taskId) && trial.arm === 'with'));
  return {
    skillId,
    commitSha,
    tasks: results,
    pooled: { with: pooledWith, without: pooledWithout, comparison: compareArms(pooledWith, pooledWithout) },
    falseTrigger: negative.size
      ? { n: controls.n, triggered: controls.triggered, rate: controls.triggerRate, wilson95: controls.triggerWilson95 }
      : null,
  };
}
