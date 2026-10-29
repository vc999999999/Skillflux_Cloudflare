import { hiddenTests, ownTests } from '../../_lib/node-tests.mjs';

export default async ({ workDir }) => ({ assertions: [
  hiddenTests(workDir, 'src/duration.js', `
test('parseDuration', () => {
  assert.equal(mod.parseDuration('1h30m'), 90);
  assert.equal(mod.parseDuration('0h5m'), 5);
  assert.equal(mod.parseDuration('3h0m'), 180);
  assert.equal(mod.parseDuration('2h'), 120);
  assert.equal(mod.parseDuration('45m'), 45);
  assert.throws(() => mod.parseDuration('abc'));
});`),
  ownTests(workDir, 'parseDuration'),
] });
