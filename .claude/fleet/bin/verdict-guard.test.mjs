// node --test .claude/fleet/bin/verdict-guard.test.mjs  (npm run test:fleet-scheduler)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  VERDICT_MAX_SPAWNS,
  VERDICT_MAX_STARTS,
  VERDICT_RETRY_COOLDOWN_MS,
  decideVerdictSpawn,
  parseVerdictMarker,
  roleHasAnswerBudget,
  serializeVerdictMarker,
} from './verdict-guard.mjs';

const NOW = 1_790_000_000_000;
const fresh = { last: 0, spawns: 0, stranded: false, escalated: false };

test('legacy bare-number marker is read as one past spawn', () => {
  assert.deepEqual(parseVerdictMarker('1790000000000\n'), { last: 1790000000000, spawns: 1, stranded: false, escalated: false });
});

test('missing or corrupt marker is a fresh verdict', () => {
  assert.deepEqual(parseVerdictMarker(''), fresh);
  assert.deepEqual(parseVerdictMarker('{broken'), fresh);
});

test('JSON marker round-trips', () => {
  const state = { last: NOW, spawns: 4, stranded: true, escalated: false };
  assert.deepEqual(parseVerdictMarker(serializeVerdictMarker(state)), state);
});

test('first sighting spawns', () => {
  assert.deepEqual(decideVerdictSpawn({ marker: fresh, starts: 0, now: NOW }), { action: 'spawn' });
});

test('inside the cooldown it skips', () => {
  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS + 1, spawns: 1 };
  assert.equal(decideVerdictSpawn({ marker, starts: 1, now: NOW }).action, 'skip');
});

test('a far-future legacy marker (manual containment) is skipped forever', () => {
  const marker = parseVerdictMarker('99999999999999');
  assert.equal(decideVerdictSpawn({ marker, starts: 0, now: NOW }).action, 'skip');
});

test('lock-skips alone do not strand a verdict before the spawn backstop', () => {
  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: VERDICT_MAX_SPAWNS - 1 };
  assert.deepEqual(decideVerdictSpawn({ marker, starts: 0, now: NOW }), { action: 'spawn' });
});

test('strands after VERDICT_MAX_STARTS real runs (the 2026-09-27 loop stops at 3, not 45)', () => {
  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: 3 };
  assert.equal(decideVerdictSpawn({ marker, starts: VERDICT_MAX_STARTS, now: NOW }).action, 'strand');
});

test('strands after VERDICT_MAX_SPAWNS spawns even with no recorded start', () => {
  const marker = { ...fresh, last: NOW - VERDICT_RETRY_COOLDOWN_MS, spawns: VERDICT_MAX_SPAWNS };
  assert.equal(decideVerdictSpawn({ marker, starts: 0, now: NOW }).action, 'strand');
});

test('a stranded verdict escalates until the escalation succeeded, then is skipped', () => {
  assert.deepEqual(decideVerdictSpawn({ marker: { ...fresh, stranded: true }, starts: 3, now: NOW }), { action: 'escalate' });
  assert.equal(decideVerdictSpawn({ marker: { ...fresh, stranded: true, escalated: true }, starts: 3, now: NOW }).action, 'skip');
});

test('per-role answer budget', () => {
  assert.equal(roleHasAnswerBudget(9, 10), true);
  assert.equal(roleHasAnswerBudget(10, 10), false);
});
