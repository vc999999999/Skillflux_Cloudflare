import { check, readText } from '../../_lib/grade-lib.mjs';

export default async ({ workDir }) => {
  const text = readText(workDir, 'README.md') ?? '';
  const sentences = text.split(/[.!?](?:\s|$)/).filter(part => part.trim().length > 10).length;
  return { assertions: [check('readme', sentences >= 2 && /npm test/.test(text), `${sentences} sentence(s); ${/npm test/.test(text) ? 'mentions' : 'does not mention'} npm test`)] };
};
