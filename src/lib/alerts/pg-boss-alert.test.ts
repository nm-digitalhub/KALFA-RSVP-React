import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sendSlackAlert } = vi.hoisted(() => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert }));

import { reportPgBossError } from './pg-boss-alert';

beforeEach(() => {
  sendSlackAlert.mockReset().mockResolvedValue(null);
});

const lastAlert = () => sendSlackAlert.mock.calls.at(-1)![0] as {
  level: string;
  title: string;
  source: string;
  detail: string;
  fields: Record<string, string>;
  category: string;
};

describe('reportPgBossError', () => {
  it('names the class in the title and the process in the source and the fields', async () => {
    await reportPgBossError(
      Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'read', errno: -110 }),
      'kalfa-worker',
    );
    expect(lastAlert()).toMatchObject({
      level: 'error',
      category: 'errors',
      title: 'pg-boss error: read_etimedout',
      source: 'pgboss/kalfa-worker',
      fields: { process: 'kalfa-worker', class: 'read_etimedout', code: 'ETIMEDOUT', syscall: 'read' },
    });
  });

  it('gives each class and each process its own dedup key (level|title|source)', async () => {
    const key = () => {
      const a = lastAlert();
      return `${a.level}|${a.title}|${a.source}`;
    };
    const keys = new Set<string>();
    for (const [err, proc] of [
      [new Error('Connection terminated due to connection timeout'), 'kalfa-worker'],
      [new Error('Connection terminated due to connection timeout'), 'kalfa-web-sender'],
      [Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT', syscall: 'read' }), 'kalfa-worker'],
      [Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' }), 'kalfa-worker'],
      [new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'), 'kalfa-worker'],
    ] as const) {
      await reportPgBossError(err, proc);
      keys.add(key());
    }
    expect(keys.size).toBe(5);
  });

  it('carries the queue of a worker poll error', async () => {
    await reportPgBossError(
      new Error('Connection terminated due to connection timeout (Queue: outreach-arm, Worker: 912461c2-1dcb-4695-86a5-9f514ab44690)'),
      'kalfa-worker',
    );
    expect(lastAlert().fields).toMatchObject({ class: 'connect_timeout', queue: 'outreach-arm' });
  });

  it('never sends the error message, so a connection string cannot reach Slack', async () => {
    await reportPgBossError(
      new Error('password authentication failed for postgresql://postgres.abc:hunter2@pooler.example:5432/postgres'),
      'kalfa-web-sender',
    );
    const sent = JSON.stringify(lastAlert());
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('postgresql://');
    expect(sent).not.toContain('pooler.example');
    expect(lastAlert().title).toBe('pg-boss error: other');
  });
});
