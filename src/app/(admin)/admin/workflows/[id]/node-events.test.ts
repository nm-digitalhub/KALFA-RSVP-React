import { describe, expect, it } from 'vitest';

import type { StreamEvent } from '@/lib/workflow/execution-events';

import { formatDuration, INLINE_MAX_CHARS, measureInfo, nodeAttempts } from './node-events';

let seq = 0;
const ev = (type: string, nodeId: string | undefined, timestamp: string, payload?: unknown): StreamEvent => ({
  seq: ++seq,
  type,
  nodeId,
  timestamp,
  payload,
});

describe('nodeAttempts — the full event log of one step', () => {
  it('pairs start and end, with the measured duration', () => {
    const events = [
      ev('execution_started', undefined, '2026-09-25T10:00:00.000Z'),
      ev('node_started', 'a', '2026-09-25T10:00:00.000Z'),
      ev('node_completed', 'a', '2026-09-25T10:00:03.200Z', { output: { ok: true } }),
      ev('node_started', 'b', '2026-09-25T10:00:04.000Z'),
    ];
    expect(nodeAttempts(events, 'a')).toEqual([
      {
        status: 'completed',
        startedAt: '2026-09-25T10:00:00.000Z',
        endedAt: '2026-09-25T10:00:03.200Z',
        durationMs: 3200,
        output: { ok: true },
      },
    ]);
  });

  it('keeps EVERY run of a step that ran twice, not only the last', () => {
    const events = [
      ev('node_started', 'a', '2026-09-25T10:00:00Z'),
      ev('node_failed', 'a', '2026-09-25T10:00:01Z', { error: { message: 'first' } }),
      ev('node_started', 'a', '2026-09-25T10:00:05Z'),
      ev('node_completed', 'a', '2026-09-25T10:00:06Z', { output: 2 }),
    ];
    const attempts = nodeAttempts(events, 'a');
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'completed']);
    expect(attempts[0]!.error).toEqual({ message: 'first' });
    expect(attempts[1]!.output).toBe(2);
  });

  it('a wait stays on the same run, and its resume closes it', () => {
    const events = [
      ev('node_started', 'w', '2026-09-25T10:00:00Z'),
      ev('node_waiting', 'w', '2026-09-25T10:00:00Z', { resumeAt: '2026-09-26T10:00:00Z', waitKind: 'timer' }),
      ev('node_completed', 'w', '2026-09-26T10:00:01Z', { output: null }),
    ];
    const [attempt, ...rest] = nodeAttempts(events, 'w');
    expect(rest).toHaveLength(0);
    expect(attempt).toMatchObject({ status: 'completed', resumeAt: '2026-09-26T10:00:00Z', waitKind: 'timer' });
  });

  it('a still-open wait reports waiting with no end', () => {
    const events = [
      ev('node_started', 'w', '2026-09-25T10:00:00Z'),
      ev('node_waiting', 'w', '2026-09-25T10:00:00Z', { resumeAt: '2026-09-26T10:00:00Z', waitKind: 'event' }),
    ];
    expect(nodeAttempts(events, 'w')).toEqual([
      { status: 'waiting', startedAt: '2026-09-25T10:00:00Z', resumeAt: '2026-09-26T10:00:00Z', waitKind: 'event' },
    ]);
  });

  it('no duration when the clock did not move (a dry run stamps one time)', () => {
    const t = '2026-09-25T10:00:00Z';
    const [attempt] = nodeAttempts([ev('node_started', 'a', t), ev('node_completed', 'a', t, { output: 1 })], 'a');
    expect(attempt!.durationMs).toBeUndefined();
  });

  it('an end without a start is kept, not dropped', () => {
    const [attempt] = nodeAttempts([ev('node_failed', 'a', '2026-09-25T10:00:00Z', { error: { message: 'x' } })], 'a');
    expect(attempt).toMatchObject({ status: 'failed', error: { message: 'x' } });
    expect(attempt!.startedAt).toBeUndefined();
  });

  it('a skipped step carries its reason', () => {
    expect(nodeAttempts([ev('node_skipped', 's', '2026-09-25T10:00:00Z', { reason: 'branch_not_taken' })], 's')).toEqual([
      { status: 'skipped', endedAt: '2026-09-25T10:00:00Z', skipReason: 'branch_not_taken' },
    ]);
  });

  it('a step that never ran has no entries', () => {
    expect(nodeAttempts([ev('node_started', 'a', '2026-09-25T10:00:00Z')], 'b')).toEqual([]);
  });
});

describe('measureInfo — decided by the amount, not by the event type', () => {
  it('nothing to show', () => {
    for (const value of [undefined, null, '', '   ', {}, []]) {
      expect(measureInfo(value), JSON.stringify(value)).toEqual({ kind: 'none' });
    }
  });

  it('a short value prints as is', () => {
    expect(measureInfo('הצעד נכשל')).toEqual({ kind: 'short', text: 'הצעד נכשל' });
    expect(measureInfo({ sent: true })).toEqual({ kind: 'short', text: '{"sent":true}' });
    expect(measureInfo(0)).toEqual({ kind: 'short', text: '0' });
    expect(measureInfo(false)).toEqual({ kind: 'short', text: 'false' });
  });

  it('a long object is summarised by its number of fields', () => {
    const value = { a: 'x'.repeat(INLINE_MAX_CHARS), nested: { b: 1, c: [1, 2] } };
    expect(measureInfo(value)).toEqual({ kind: 'long', summary: '4 שדות' });
  });

  it('a long text is summarised by its opening', () => {
    const text = 'א'.repeat(INLINE_MAX_CHARS + 10);
    expect(measureInfo(text)).toEqual({ kind: 'long', summary: `${'א'.repeat(INLINE_MAX_CHARS)}…` });
  });
});

describe('formatDuration', () => {
  it('reads in Hebrew at every scale', () => {
    expect(formatDuration(400)).toBe('פחות משנייה');
    expect(formatDuration(3200)).toBe('3.2 שניות');
    expect(formatDuration(60_000)).toBe('דקה');
    expect(formatDuration(125_000)).toBe('2 דקות ו-5 שניות');
  });
});
