import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// These test the structure of the shipped skill, not model behavior. Wording is
// reviewed by people; pinning phrases here only makes the skill harder to improve.
const root = fileURLToPath(new URL('..', import.meta.url));
const skillDirectory = join(root, 'skills/duet');
const skill = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
const references = readdirSync(join(skillDirectory, 'references')).filter(name => name.endsWith('.md'));

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => match[1])
    .filter(target => !/^(?:[a-z]+:|#)/i.test(target))
    .map(target => target.split('#')[0]);
}

const shippedDocuments = [join(root, 'README.md'), ...markdownFiles(skillDirectory), ...markdownFiles(join(root, 'docs'))];

test('every reference is routed from SKILL.md', () => {
  for (const name of references) assert.ok(skill.includes(`(references/${name})`), `${name} is not linked from SKILL.md`);
});

test('relative links in the skill, docs and README resolve', () => {
  for (const path of shippedDocuments) {
    for (const target of relativeLinks(readFileSync(path, 'utf8'))) {
      assert.ok(existsSync(join(dirname(path), target)), `${path} links to missing ${target}`);
    }
  }
});

test('SKILL.md stays small enough to load on every task', () => {
  const body = skill.split('---').slice(2).join('---');
  assert.ok(body.split(/\s+/).filter(Boolean).length <= 1500);
  assert.match(skill.split('---')[1], /^name: duet$/m);
});
