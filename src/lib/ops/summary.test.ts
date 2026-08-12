import { describe, expect, it } from 'vitest';

import {
  severityForThreshold,
  severityForSwapUsage,
  severityForSwapActivity,
  worseSeverity,
  computeOverallStatus,
  CONNECTIONS_WARN_RATIO,
  CONNECTIONS_ERROR_RATIO,
} from './summary';
import type { SystemProbe } from './agent-client';
import type { DbHealthRow } from './db-health';

function systemProbe(overrides: Partial<SystemProbe> = {}): SystemProbe {
  return {
    disk: { fs: '/dev/sda1', type: 'ext4', sizeGB: 100, usedGB: 40, availGB: 60, pct: 40 },
    mem: { totalMB: 16000, availMB: 8000, pct: 50, swapUsedMB: 1000, swapTotalMB: 16000, swapPct: 6 },
    swapActivity: null,
    load: [0.5, 0.4, 0.3],
    uptimeSec: 3600,
    nodeVersion: 'v22.0.0',
    puppeteerCache: { chrome: true, headlessShell: true },
    logsDirBytes: { fleetDrafts: 0, pm2Logs: 0 },
    ...overrides,
  };
}

function dbHealth(overrides: Partial<DbHealthRow> = {}): DbHealthRow {
  return {
    activeConnections: 10,
    maxConnections: 60,
    indexHitRatePct: 100,
    tableHitRatePct: 100,
    longestQuerySeconds: null,
    topQueries: [],
    ...overrides,
  };
}

describe('severityForThreshold', () => {
  it('returns ok below the warn threshold', () => {
    expect(severityForThreshold(50, 85, 95)).toBe('ok');
  });
  it('returns warn at/above the warn threshold', () => {
    expect(severityForThreshold(85, 85, 95)).toBe('warn');
    expect(severityForThreshold(90, 85, 95)).toBe('warn');
  });
  it('returns error at/above the error threshold', () => {
    expect(severityForThreshold(95, 85, 95)).toBe('error');
  });
});

describe('severityForSwapUsage', () => {
  it('never returns error, however full swap capacity is — usage alone is not proof of active pressure', () => {
    expect(severityForSwapUsage(59)).toBe('ok');
    expect(severityForSwapUsage(60)).toBe('warn');
    expect(severityForSwapUsage(99)).toBe('warn');
    expect(severityForSwapUsage(100)).toBe('warn');
  });
});

describe('severityForSwapActivity', () => {
  it('is ok for near-zero background churn', () => {
    expect(severityForSwapActivity(3.5, 6.2)).toBe('ok');
  });
  it('takes the max of in/out rate against the warn tier', () => {
    expect(severityForSwapActivity(25, 1)).toBe('warn');
    expect(severityForSwapActivity(1, 25)).toBe('warn');
  });
  it('escalates to error at sustained high rate', () => {
    expect(severityForSwapActivity(150, 0)).toBe('error');
  });
});

describe('worseSeverity', () => {
  it('picks the higher-ranked severity regardless of argument order', () => {
    expect(worseSeverity('ok', 'warn')).toBe('warn');
    expect(worseSeverity('warn', 'ok')).toBe('warn');
    expect(worseSeverity('warn', 'error')).toBe('error');
    expect(worseSeverity('ok', 'ok')).toBe('ok');
  });
});

describe('computeOverallStatus', () => {
  const baseInput = {
    processes: { ok: true as const, data: { pm2: [], declared: [], undeclared: [], missing: [] } },
    errorCountLast1h: 0,
  };

  it('stays ok when disk/connections/swap are all under threshold', () => {
    const status = computeOverallStatus({
      ...baseInput,
      system: { ok: true, data: systemProbe() },
      jobHealth: [],
      dbHealth: dbHealth(),
    });
    expect(status.level).toBe('ok');
    expect(status.reasons).toHaveLength(0);
  });

  it('warns on high swap usage percentage even with no active churn', () => {
    const status = computeOverallStatus({
      ...baseInput,
      system: { ok: true, data: systemProbe({ mem: { totalMB: 16000, availMB: 8000, pct: 50, swapUsedMB: 10000, swapTotalMB: 16000, swapPct: 63 } }) },
      jobHealth: [],
      dbHealth: dbHealth(),
    });
    expect(status.level).toBe('warn');
    expect(status.reasons.some((r) => r.includes('Swap'))).toBe(true);
  });

  it('does NOT treat nearly-full swap as error without active churn — usage alone caps at warn', () => {
    const status = computeOverallStatus({
      ...baseInput,
      system: {
        ok: true,
        data: systemProbe({
          mem: { totalMB: 16000, availMB: 8000, pct: 50, swapUsedMB: 15200, swapTotalMB: 16000, swapPct: 95 },
          swapActivity: { pswpinPerSec: 0, pswpoutPerSec: 0, sampledAt: '19:20:00' },
        }),
      },
      jobHealth: [],
      dbHealth: dbHealth(),
    });
    expect(status.level).toBe('warn');
  });

  it('errors on sustained high swap page-in/out activity', () => {
    const status = computeOverallStatus({
      ...baseInput,
      system: {
        ok: true,
        data: systemProbe({ swapActivity: { pswpinPerSec: 200, pswpoutPerSec: 50, sampledAt: '19:20:00' } }),
      },
      jobHealth: [],
      dbHealth: dbHealth(),
    });
    expect(status.level).toBe('error');
    expect(status.reasons.some((r) => r.includes('פעילות Swap'))).toBe(true);
  });

  it('escalates connections from warn to error at the error ratio', () => {
    const warnConns = Math.ceil(60 * CONNECTIONS_WARN_RATIO);
    const errorConns = Math.ceil(60 * CONNECTIONS_ERROR_RATIO);

    const warnStatus = computeOverallStatus({
      ...baseInput,
      system: { ok: true, data: systemProbe() },
      jobHealth: [],
      dbHealth: dbHealth({ activeConnections: warnConns, maxConnections: 60 }),
    });
    expect(warnStatus.level).toBe('warn');

    const errorStatus = computeOverallStatus({
      ...baseInput,
      system: { ok: true, data: systemProbe() },
      jobHealth: [],
      dbHealth: dbHealth({ activeConnections: errorConns, maxConnections: 60 }),
    });
    expect(errorStatus.level).toBe('error');
  });
});
