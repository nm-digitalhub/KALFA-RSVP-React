import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

import { readFile } from 'node:fs/promises';
import { requirePlatformOwner } from '@/lib/auth/dal';
import { getRelocationState } from './relocation';

// A full, valid state file exercising every step status — deliberately
// including every field the whitelist must STRIP: backups (server paths),
// externalCalls, error.logPath, planLines, reportPath, writer identity, and
// an unknown extra key.
function fullState(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    serial: 14,
    runId: '7f3a',
    createdAt: '2026-08-23T04:55:02Z',
    updatedAt: '2026-08-23T05:07:31Z',
    writer: { pid: 41230, host: 'kalfa-host', user: 'vhost-user' },
    target: { origin: 'https://new.example' },
    previous: { origin: 'https://beta.kalfa.me' },
    mode: 'interactive',
    phase: 'waiting',
    stages: [
      {
        id: 'C',
        label: { en: 'Infrastructure', he: 'תשתית' },
        steps: [
          {
            id: 'C1',
            label: { en: 'Plesk registration', he: 'רישום ב-Plesk' },
            status: 'done',
            startedAt: '2026-08-23T04:56:00Z',
            endedAt: '2026-08-23T04:56:02Z',
            attempt: 1,
            backups: [{ path: '/etc/nginx/conf.d/x.conf', backupPath: '/root/x.conf.bak' }],
            externalCalls: [
              { service: 'supabase-auth', op: 'PATCH config/auth', prevValue: { site_url: 's' } },
            ],
            planLines: ['write /etc/nginx/conf.d/new.conf'],
            verification: {
              ok: true,
              checks: [{ label: { en: 'nginx -t', he: 'בדיקת nginx' }, ok: true, detail: 'ok' }],
            },
          },
          {
            id: 'C2',
            label: { en: 'Issue TLS certificate', he: 'הנפקת תעודת TLS' },
            status: 'waiting-external',
            startedAt: '2026-08-23T04:57:00Z',
            attempt: 3,
            backups: [],
            waiting: {
              kind: 'cert-issuance-retry',
              detail: { en: 'DNS not propagated', he: 'ה-DNS טרם התעדכן' },
              attempts: 3,
              nextPollAt: '2026-08-23T05:12:00Z',
              pollEverySec: 300,
            },
          },
          {
            id: 'C3',
            label: { en: 'Write vhost', he: 'כתיבת vhost' },
            status: 'failed',
            attempt: 1,
            backups: [],
            error: {
              message: 'nginx test failed',
              logPath: '/var/log/relocate/7f3a/C3.log',
              hint: { en: 'check the template', he: 'בדקו את התבנית' },
            },
          },
          {
            id: 'C4',
            label: { en: 'Reload nginx', he: 'טעינת nginx מחדש' },
            status: 'pending',
            attempt: 1,
            backups: [],
          },
          {
            id: 'C5',
            label: { en: 'Old step', he: 'צעד ישן' },
            status: 'rolled-back',
            attempt: 1,
            backups: [],
          },
          {
            id: 'C6',
            label: { en: 'Skipped step', he: 'צעד שדולג' },
            status: 'skipped',
            attempt: 1,
            backups: [],
          },
        ],
      },
    ],
    gates: [
      {
        id: 'go-live',
        label: { en: 'Approve the plan and start', he: 'אישור התוכנית והתחלה' },
        consequence: { en: 'Restarts the app', he: 'מפעיל מחדש את האפליקציה' },
        status: 'approved',
        decidedAt: '2026-08-23T04:58:11Z',
        decidedBy: 'operator',
        choice: 'start',
      },
      {
        id: 'conflict-existing-site',
        label: { en: 'Existing site', he: 'אתר קיים' },
        consequence: { en: 'Shadows it', he: 'מצל עליו' },
        status: 'open',
      },
    ],
    openItems: [
      { id: 'android', label: { en: 'Android release', he: 'גרסת אנדרואיד' }, severity: 'warn' },
    ],
    rollbacks: [{ stepId: 'C5', at: '2026-08-23T05:01:00Z' }],
    reportPath: '/var/www/vhosts/kalfa.me/beta/.relocate/report-7f3a.md',
    unknownExtraKey: { secretPath: '/etc/shadow' },
    ...overrides,
  };
}

function mockFile(content: string) {
  vi.mocked(readFile).mockResolvedValue(content);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue({ id: 'owner' } as never);
});

describe('getRelocationState', () => {
  it('returns no-run when the state file does not exist', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(err);
    await expect(getRelocationState()).resolves.toEqual({ kind: 'no-run' });
  });

  it('returns unreadable on a permissions error, without throwing', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValue(err);
    await expect(getRelocationState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('returns unreadable on malformed JSON (mid-write race), without throwing', async () => {
    mockFile('{"schemaVersion":1,"runId":"7f3a"'); // truncated
    await expect(getRelocationState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('returns unreadable on a schema-invalid document', async () => {
    mockFile(JSON.stringify({ schemaVersion: 1, runId: '' }));
    await expect(getRelocationState()).resolves.toEqual({ kind: 'unreadable' });
  });

  it('returns unsupported-version for a future schemaVersion', async () => {
    mockFile(JSON.stringify(fullState({ schemaVersion: 2 })));
    await expect(getRelocationState()).resolves.toEqual({ kind: 'unsupported-version' });
  });

  it('defaults flavor to relocate and passes an install flavor through', async () => {
    mockFile(JSON.stringify(fullState()));
    const legacy = await getRelocationState();
    expect(legacy.kind === 'ok' && legacy.run.flavor).toBe('relocate');

    mockFile(JSON.stringify({ ...fullState(), flavor: 'install' }));
    const install = await getRelocationState();
    expect(install.kind === 'ok' && install.run.flavor).toBe('install');
  });

  it('parses a full state and never leaks path-bearing or writer-identity fields', async () => {
    mockFile(JSON.stringify(fullState()));
    const view = await getRelocationState();
    expect(view.kind).toBe('ok');
    if (view.kind !== 'ok') return;

    // The forbidden fields exist in the INPUT fixture; the serialized view
    // must not contain any of them — by key or by value.
    const serialized = JSON.stringify(view);
    for (const forbiddenKey of [
      'backups',
      'backupPath',
      'externalCalls',
      'logPath',
      'planLines',
      'reportPath',
      'unknownExtraKey',
      'secretPath',
      'pid',
      'host',
      'user',
    ]) {
      expect(serialized, `view must not contain key "${forbiddenKey}"`).not.toContain(
        `"${forbiddenKey}"`,
      );
    }
    for (const forbiddenValue of [
      '/etc/nginx',
      '/root/',
      '/var/log/',
      '/etc/shadow',
      '.relocate/report',
      'kalfa-host',
      'vhost-user',
    ]) {
      expect(serialized, `view must not contain value "${forbiddenValue}"`).not.toContain(
        forbiddenValue,
      );
    }

    // Whitelisted content is present and correctly shaped.
    expect(view.run.runId).toBe('7f3a');
    expect(view.run.targetOrigin).toBe('https://new.example');
    expect(view.run.previousOrigin).toBe('https://beta.kalfa.me');
    expect(view.run.writerPresent).toBe(true);
    expect(view.run.gates).toHaveLength(2);
    expect(view.run.rollbacks).toEqual([{ stepId: 'C5', at: '2026-08-23T05:01:00Z' }]);

    const steps = view.run.stages[0].steps;
    expect(steps.map((s) => s.status)).toEqual([
      'done',
      'waiting-external',
      'failed',
      'pending',
      'rolled-back',
      'skipped',
    ]);
    // error.message (sanitized one-liner) survives; logPath does not.
    const failed = steps.find((s) => s.status === 'failed');
    expect(failed?.error).toEqual({
      message: 'nginx test failed',
      hint: { en: 'check the template', he: 'בדקו את התבנית' },
    });
    // Progress: 6 steps, 1 skipped → total 5, done 1. Focus = first attention step (C2).
    expect(view.run.progress).toEqual({ done: 1, total: 5 });
    expect(view.run.focusStepId).toBe('C2');
  });

  it('computes heartbeat staleness while executing', async () => {
    // updatedAt far in the past + executing → stale.
    mockFile(
      JSON.stringify(fullState({ phase: 'executing', updatedAt: '2026-08-23T00:00:00Z' })),
    );
    const stale = await getRelocationState();
    expect(stale.kind === 'ok' && stale.run.writerStale).toBe(true);

    // Fresh heartbeat → not stale.
    mockFile(
      JSON.stringify(
        fullState({ phase: 'executing', updatedAt: new Date().toISOString() }),
      ),
    );
    const fresh = await getRelocationState();
    expect(fresh.kind === 'ok' && fresh.run.writerStale).toBe(false);

    // Stale timestamp but NOT executing (waiting on Meta for days is normal).
    mockFile(
      JSON.stringify(fullState({ phase: 'waiting', updatedAt: '2026-08-23T00:00:00Z' })),
    );
    const waiting = await getRelocationState();
    expect(waiting.kind === 'ok' && waiting.run.writerStale).toBe(false);
  });

  it('propagates the auth gate rejection (non-owner never reads the file)', async () => {
    const redirect = new Error('NEXT_REDIRECT');
    vi.mocked(requirePlatformOwner).mockRejectedValue(redirect);
    await expect(getRelocationState()).rejects.toBe(redirect);
    expect(readFile).not.toHaveBeenCalled();
  });
});
