import { check, inspect } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const out = inspect('pdf', workDir, 'page-two.pdf');
  const source = inspect('pdf', workDir, 'report.pdf');
  return { assertions: [
    check('pages', out.pages === 1, out.error ?? `${out.pages} page(s)`),
    check('content', /REPORT-P2-ORCHID/.test(out.text?.[0] ?? ''), /REPORT-P2-ORCHID/.test(out.text?.[0] ?? '') ? 'second page' : 'not the second page'),
    check('source-intact', source.pages === 3, source.error ?? `report.pdf has ${source.pages} page(s)`),
  ] };
};
