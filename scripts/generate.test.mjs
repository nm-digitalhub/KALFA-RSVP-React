import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extract, render } from './generate.mjs';
const markdown = await readFile(new URL('../docs/error-codes.md', import.meta.url), 'utf8');
const data = extract(markdown);
test('complete attached source', () => {
  assert.equal(data.sourceRows, 94);
  assert.equal(data.entries.length, 95);
  assert.equal(data.knownCodes.length, 84);
  assert.equal(data.entries.filter(e => e.code === 2388103).length, 9);
  assert.equal(data.entries.filter(e => e.code === 2388091).length, 1);
  assert.equal(data.entries.filter(e => e.code === 2388093).length, 1);
  assert.equal(data.entries.filter(e => e.api === 'marketing').length, 8);
  assert.equal(data.entries.filter(e => e.code === 100).length, 2);
  assert.equal(data.entries.filter(e => e.code === 131009).length, 2);
  const range = data.entries.find(e => e.kind === 'range');
  assert.equal(range.min, 200);
  assert.equal(range.max, 299);
  assert.ok(data.entries.some(e => e.code === 200 && e.kind === 'exact'));
});
test('encoded content, links and title are preserved', () => {
  const entry = data.entries.find(e => e.code === 2593085);
  assert.equal(entry.title, 'Invalid WhatsApp Business Account for OBO Mobility');
  assert.ok(!entry.description.includes('&lt;'));
  assert.ok(entry.description.includes('\n'));
  assert.ok(entry.links.length > 0);
  assert.ok(data.entries.find(e => e.code === 134102).httpStatus === 500);
});
test('generation is deterministic', () => assert.equal(render(markdown), render(markdown)));
test('unexpected source changes fail visibly', () => {
  assert.throws(() => extract(markdown.replace('| Code | `details` |', '| Number | `details` |')), /Unknown table/);
});
