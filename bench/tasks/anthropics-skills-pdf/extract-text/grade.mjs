import { check, exists, readText } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const text = readText(workDir, 'notice.txt') ?? '';
  const first = text.indexOf('AMBER-HERON-11');
  const second = text.indexOf('COBALT-FINCH-27');
  return { assertions: [
    exists(workDir, 'notice.txt'),
    check('markers', first >= 0 && second >= 0, `page 1 marker ${first >= 0 ? 'found' : 'missing'}, page 2 marker ${second >= 0 ? 'found' : 'missing'}`),
    check('order', first >= 0 && second > first, first >= 0 && second >= 0 ? (second > first ? 'pages in order' : 'pages out of order') : 'cannot check order'),
  ] };
};
