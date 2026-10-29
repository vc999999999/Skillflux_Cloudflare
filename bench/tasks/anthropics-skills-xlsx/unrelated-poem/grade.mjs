import { check, readText } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const lines = (readText(workDir, 'poem.txt') ?? '').split('\n').filter(line => line.trim());
  return { assertions: [check('poem', lines.length >= 4, `${lines.length} non-empty line(s)`)] };
};
