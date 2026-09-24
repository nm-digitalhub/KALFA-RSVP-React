import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import {
  OWNER_AGENT_PM2_KILL_TIMEOUT_MS,
  OWNER_AGENT_REPLY_EXPIRE_SECONDS,
  OWNER_AGENT_REPLY_MAX_MS,
  OWNER_AGENT_REPLY_QUEUE_POLICY,
  OWNER_AGENT_RESUME_FAIL_FAST_MS,
  OWNER_AGENT_RUN_KILL_AFTER_MS,
  OWNER_AGENT_RUN_TIMEOUT_MS,
  OWNER_AGENT_STOP_TIMEOUT_MS,
} from './budgets';

// The budget chain, asserted rather than trusted (budgets.ts header):
// one answer < job expiry < graceful stop < pm2 kill_timeout.

const require = createRequire(import.meta.url);
type Ecosystem = { apps: Array<{ name: string; kill_timeout?: number; script?: string; node_args?: string; env?: Record<string, string> }> };
const ecosystem = require(path.join(import.meta.dirname, '../../../../ecosystem.config.cjs')) as Ecosystem;
const app = ecosystem.apps.find((a) => a.name === 'kalfa-owner-agent');

describe('the owner-agent budget chain', () => {
  it('one answer fits inside the job expiry', () => {
    expect(OWNER_AGENT_REPLY_MAX_MS).toBe(
      OWNER_AGENT_RESUME_FAIL_FAST_MS + OWNER_AGENT_RUN_TIMEOUT_MS + OWNER_AGENT_RUN_KILL_AFTER_MS + 50_000,
    );
    expect(OWNER_AGENT_REPLY_MAX_MS).toBeLessThan(OWNER_AGENT_REPLY_EXPIRE_SECONDS * 1000);
  });

  it('the queue policy carries that expiry', () => {
    expect(OWNER_AGENT_REPLY_QUEUE_POLICY.expireInSeconds).toBe(OWNER_AGENT_REPLY_EXPIRE_SECONDS);
  });

  it('a graceful stop outlasts the expiry', () => {
    expect(OWNER_AGENT_STOP_TIMEOUT_MS).toBeGreaterThan(OWNER_AGENT_REPLY_EXPIRE_SECONDS * 1000);
  });

  it('pm2 waits longer than the graceful stop — and the ecosystem entry says so', () => {
    expect(OWNER_AGENT_PM2_KILL_TIMEOUT_MS).toBeGreaterThan(OWNER_AGENT_STOP_TIMEOUT_MS);
    expect(app?.kill_timeout).toBe(OWNER_AGENT_PM2_KILL_TIMEOUT_MS);
  });

  it('the pm2 entry runs the bundle with its env file and Mastra telemetry off', () => {
    expect(app).toMatchObject({
      script: 'dist/owner-agent.cjs',
      node_args: '--env-file=.env.local',
      env: expect.objectContaining({ MASTRA_TELEMETRY_DISABLED: 'true', TZ: 'Asia/Jerusalem' }),
    });
  });
});
