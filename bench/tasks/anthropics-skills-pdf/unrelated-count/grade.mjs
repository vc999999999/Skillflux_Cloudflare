import { check, readText } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const value = (readText(workDir, 'count.txt') ?? '').trim();
  return { assertions: [check('count', value === '5', `count.txt: ${value || 'missing'}`)] };
};
