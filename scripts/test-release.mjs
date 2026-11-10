import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelog, requireSuccessfulCI } from './release.mjs';
const entry = (version = '1.2.3', date = '2026-10-21') => `## [${version}] - ${date}\n\n### Fixed\n\n- Correct behavior.\n\n### Breaking changes\n\n- None.\n\n### Migration\n\n- None.\n`;
const valid = '# Changelog\n\n## [Unreleased]\n\n' + entry();
test('extracts exactly the requested body, excluding adjacent releases', () => {
  const parsed = parseChangelog(valid + '\n' + entry('1.2.2'), '1.2.3');
  assert.equal(parsed.size, 2);
  assert.match(parsed.get('1.2.3'), /Correct behavior/);
  assert.doesNotMatch(parsed.get('1.2.3'), /1\.2\.2/);
});
test('rejects version drift, duplicates, order, malformed dates and unfinished notes', () => {
  for (const text of [valid + entry(), valid + entry('1.2.4'), valid.replace('2026-10-21', '2026-02-30'), valid.replace('Correct behavior.', 'TODO'), valid.replace('### Migration', '### Other'), valid.replace('### Breaking changes', '### Other'), valid.replace('1.2.3', '01.2.3'), valid.replace('## [Unreleased]', '## Upcoming')]) {
    assert.throws(() => parseChangelog(text, '1.2.3'));
  }
  assert.throws(() => parseChangelog(valid, '1.2.4'));
});

test('publication requires latest matching CI, not an older success or another workflow', () => {
  const good = { workflowName: 'CI', status: 'completed', conclusion: 'success' };
  requireSuccessfulCI([good], 'CI');
  for (const runs of [[], [{ ...good, workflowName: 'Other' }], [{ ...good, status: 'in_progress' }, good], [{ ...good, conclusion: 'failure' }, good], [{ ...good, conclusion: 'skipped' }], [{ ...good, conclusion: 'cancelled' }]]) {
    assert.throws(() => requireSuccessfulCI(runs, 'CI'));
  }
});
