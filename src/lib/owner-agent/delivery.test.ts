import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import {
  metaReasonCode,
  recordOwnerAgentDelivery,
  type DeliveryDeps,
  type OwnerAgentMessageMatch,
} from '@/lib/owner-agent/delivery';

const AGENT_NUMBER = '1298694319994421';
const REPLY: OwnerAgentMessageMatch = {
  kind: 'reply',
  intakeId: 'i1',
  staffUserId: 'u1',
  allowlistEntryId: 'a1',
};
const REPORT: OwnerAgentMessageMatch = { kind: 'report', reportRunId: 'r1', allowlistEntryId: 'a2' };

function deps(match: OwnerAgentMessageMatch | null, audit = true): DeliveryDeps {
  return {
    isAgentNumber: vi.fn(async (id: string) => id === AGENT_NUMBER),
    findMessage: vi.fn(async () => match),
    writeAudit: vi.fn(async () => audit),
    alert: vi.fn(async () => null),
  };
}

describe('recordOwnerAgentDelivery', () => {
  it('records a delivered reply against its intake, with no alert', async () => {
    const d = deps(REPLY);
    expect(await recordOwnerAgentDelivery('wamid.A', AGENT_NUMBER, 'delivered', null, d)).toBe('recorded');
    expect(d.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'delivery',
        outcome: 'delivered',
        reason_code: null,
        intake_id: 'i1',
        report_run_id: null,
        staff_user_id: 'u1',
        allowlist_entry_id: 'a1',
      }),
    );
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('records read, since Meta can skip delivered for a message read in an open chat', async () => {
    const d = deps(REPLY);
    expect(await recordOwnerAgentDelivery('wamid.A', AGENT_NUMBER, 'read', null, d)).toBe('recorded');
    expect(d.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'read' }));
  });

  it('records a failed report with the Meta code and alerts with ids only', async () => {
    const d = deps(REPORT);
    expect(await recordOwnerAgentDelivery('wamid.B', AGENT_NUMBER, 'failed', '132015', d)).toBe('recorded');
    expect(d.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason_code: 'meta_132015',
        intake_id: null,
        report_run_id: 'r1',
        allowlist_entry_id: 'a2',
      }),
    );
    expect(d.alert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(d.alert).mock.calls[0][0];
    expect(alert.fields).toEqual({ run: 'r1', code: 'meta_132015' });
    expect(JSON.stringify(alert)).not.toContain('wamid.B');
  });

  it('hashes the wamid instead of storing it', async () => {
    const d = deps(REPLY);
    await recordOwnerAgentDelivery('wamid.A', AGENT_NUMBER, 'delivered', null, d);
    const row = vi.mocked(d.writeAudit).mock.calls[0][0];
    expect(row.wamid_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('wamid.A');
  });

  it.each(['sent', 'played', 'unknown'])('ignores %s without any lookup', async (status) => {
    const d = deps(REPLY);
    expect(await recordOwnerAgentDelivery('wamid.A', AGENT_NUMBER, status, null, d)).toBe('ignored');
    expect(d.isAgentNumber).not.toHaveBeenCalled();
    expect(d.findMessage).not.toHaveBeenCalled();
  });

  it('stops at the number check for guest traffic', async () => {
    const d = deps(REPLY);
    expect(await recordOwnerAgentDelivery('wamid.G', '999', 'delivered', null, d)).toBe('not_ours');
    expect(await recordOwnerAgentDelivery('wamid.G', null, 'delivered', null, d)).toBe('not_ours');
    expect(d.findMessage).not.toHaveBeenCalled();
    expect(d.writeAudit).not.toHaveBeenCalled();
  });

  it('writes nothing for an agent-number wamid that is not a reply or report', async () => {
    const d = deps(null);
    expect(await recordOwnerAgentDelivery('wamid.X', AGENT_NUMBER, 'failed', '131049', d)).toBe('not_ours');
    expect(d.writeAudit).not.toHaveBeenCalled();
    expect(d.alert).not.toHaveBeenCalled();
  });

  it('reports audit_failed but still alerts on a failure', async () => {
    const d = deps(REPLY, false);
    expect(await recordOwnerAgentDelivery('wamid.A', AGENT_NUMBER, 'failed', '131026', d)).toBe('audit_failed');
    expect(d.alert).toHaveBeenCalledTimes(1);
  });
});

describe('metaReasonCode', () => {
  it('accepts digit codes only', () => {
    expect(metaReasonCode('131049')).toBe('meta_131049');
    expect(metaReasonCode(null)).toBeNull();
    expect(metaReasonCode('13; drop')).toBeNull();
    expect(metaReasonCode('')).toBeNull();
  });
});
