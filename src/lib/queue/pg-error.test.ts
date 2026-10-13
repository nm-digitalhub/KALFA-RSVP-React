import { describe, expect, it } from 'vitest';

import { classifyPgError, describePgError, PG_ERROR_MEANING, type PgErrorClass } from './pg-error';

// The shapes below are the ones in the production logs of 2026-10-13 and the
// message strings of pg-pool / Supavisor, not invented ones.
const nodeError = (message: string, code: string, syscall: string, errno: number) =>
  Object.assign(new Error(message), { code, syscall, errno });

describe('classifyPgError', () => {
  const cases: Array<[string, unknown, PgErrorClass]> = [
    [
      'pg-pool: a new connection did not finish within connectionTimeoutMillis',
      new Error('Connection terminated due to connection timeout'),
      'connect_timeout',
    ],
    [
      'the same, as pg-boss reports it from a worker poll (queue and worker id appended)',
      new Error('Connection terminated due to connection timeout (Queue: elevenlabs-quota-check, Worker: e81f9b9f-fd6a-4d9f-9bcc-e65cacce02b7)'),
      'connect_timeout',
    ],
    ['Node: connect ETIMEDOUT', nodeError('connect ETIMEDOUT 3.111.225.200:5432', 'ETIMEDOUT', 'connect', -110), 'connect_timeout'],
    ['pg-pool: no free pooled connection in time', new Error('timeout exceeded when trying to connect'), 'pool_wait_timeout'],
    ['Node: read ETIMEDOUT (errno -110) on an established socket', nodeError('read ETIMEDOUT', 'ETIMEDOUT', 'read', -110), 'read_etimedout'],
    ['Node: read ECONNRESET', nodeError('read ECONNRESET', 'ECONNRESET', 'read', -104), 'econnreset'],
    [
      'Supavisor: session-mode pool full',
      new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'),
      'emaxconnsession',
    ],
    ['an unrelated error', new Error('relation "pgboss.job" does not exist'), 'other'],
    ['a non-Error throw', 'boom', 'other'],
    ['null', null, 'other'],
  ];

  it.each(cases)('%s', (_label, err, expected) => {
    expect(classifyPgError(err)).toBe(expected);
  });

  it('has a meaning sentence for every class', () => {
    for (const cls of ['connect_timeout', 'pool_wait_timeout', 'read_etimedout', 'econnreset', 'emaxconnsession', 'other'] as const) {
      expect(PG_ERROR_MEANING[cls].length).toBeGreaterThan(20);
    }
  });
});

describe('describePgError', () => {
  it('keeps the code and syscall of a Node error, and nothing else of it', () => {
    expect(describePgError(nodeError('read ETIMEDOUT', 'ETIMEDOUT', 'read', -110))).toEqual({
      class: 'read_etimedout',
      code: 'ETIMEDOUT',
      syscall: 'read',
    });
  });

  it('extracts the queue name from a worker poll error', () => {
    const info = describePgError(
      new Error('Connection terminated due to connection timeout (Queue: archive-backup-sweep, Worker: 912461c2-1dcb-4695-86a5-9f514ab44690)'),
    );
    expect(info).toEqual({ class: 'connect_timeout', queue: 'archive-backup-sweep' });
  });

  it('never returns the message itself', () => {
    const secret = 'postgresql://postgres.abc:hunter2@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
    const info = describePgError(new Error(`password authentication failed for ${secret}`));
    expect(JSON.stringify(info)).not.toContain('hunter2');
    expect(JSON.stringify(info)).not.toContain('postgresql://');
    expect(info.class).toBe('other');
  });
});
