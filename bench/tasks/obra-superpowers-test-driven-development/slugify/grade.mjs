import { hiddenTests, ownTests } from '../../_lib/node-tests.mjs';

export default async ({ workDir }) => ({ assertions: [
  hiddenTests(workDir, 'src/slugify.js', `
test('slugify', () => {
  assert.equal(mod.slugify('  Hello, World! '), 'hello-world');
  assert.equal(mod.slugify('--Already--Slugged--'), 'already-slugged');
  assert.equal(mod.slugify('Multiple   spaces here'), 'multiple-spaces-here');
  assert.equal(mod.slugify('Version 2.0 Release'), 'version-2-0-release');
  assert.equal(mod.slugify('!!!'), '');
  assert.equal(mod.slugify(''), '');
});`),
  ownTests(workDir, 'slugify'),
] });
