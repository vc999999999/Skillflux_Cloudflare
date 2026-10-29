import { hiddenTests, ownTests } from '../../_lib/node-tests.mjs';

export default async ({ workDir }) => ({ assertions: [
  hiddenTests(workDir, 'src/chunk.js', `
test('chunk', () => {
  assert.deepEqual(mod.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(mod.chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  assert.deepEqual(mod.chunk([], 3), []);
  assert.deepEqual(mod.chunk([1, 2], 5), [[1, 2]]);
  for (const size of [0, -1, 1.5, NaN]) assert.throws(() => mod.chunk([1], size), RangeError);
  const input = [1, 2, 3];
  mod.chunk(input, 2);
  assert.deepEqual(input, [1, 2, 3]);
});`),
  ownTests(workDir, 'chunk'),
] });
