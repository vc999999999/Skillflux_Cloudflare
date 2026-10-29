// Approximate token count without a tokenizer: about four characters per
// token for Latin text, and one token per CJK character. Published as an
// approximation; the methodology page states the method.
export const TOKEN_METHOD = 'approx-v1: ceil(non-CJK chars / 4) + CJK chars';

const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/gu;

export function approxTokens(text: string): number {
  const cjkCount = text.match(cjk)?.length ?? 0;
  const rest = [...text.replace(cjk, '')].length;
  return Math.ceil(rest / 4) + cjkCount;
}
