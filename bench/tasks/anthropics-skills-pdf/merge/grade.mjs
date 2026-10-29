import { check, inspect } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const pdf = inspect('pdf', workDir, 'combined.pdf');
  const text = pdf.text ?? [];
  return { assertions: [
    check('pages', pdf.pages === 3, pdf.error ?? `${pdf.pages} page(s)`),
    check('order', /PART-A-ONE/.test(text[0] ?? '') && /PART-A-TWO/.test(text[1] ?? '') && /PART-B-ONE/.test(text[2] ?? ''), text.map((page, index) => `p${index + 1}: ${(page.match(/PART-[AB]-\w+/) ?? ['?'])[0]}`).join(', ') || 'no pages'),
  ] };
};
