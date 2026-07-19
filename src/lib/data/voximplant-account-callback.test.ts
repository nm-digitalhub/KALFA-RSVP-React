import { describe, expect, it, vi } from 'vitest';

// voximplant-account-callback.ts begins with `import 'server-only'` — stub it
// (established convention: voximplant-balance.test.ts). Its IO collaborators are
// mocked so importing the module never constructs a real Slack/Supabase client;
// evaluateCallbackAlerts is PURE and is what we exercise here.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantBalancePullConfig: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));
vi.mock('@/lib/data/voximplant-balance', () => ({ evaluateBalanceAlert: vi.fn() }));

import { evaluateCallbackAlerts } from './voximplant-account-callback';
import { normalizeAccountCallbackEnvelope } from '@/lib/validation/vox-payloads';

// A fixed clock so the CallerID near-expiry escalation is deterministic.
const NOW = Date.parse('2026-07-19T00:00:00Z');

// Convenience: build a normalized event with an explicit detail.
const ev = (type: string, detail: Record<string, string | number> = {}, callbackId: string | null = '1') => ({
  type,
  callbackId,
  detail,
});

describe('evaluateCallbackAlerts', () => {
  it('maps js_fail to an error in the errors category with the callback id', () => {
    const [a] = evaluateCallbackAlerts([ev('js_fail')], NOW);
    expect(a).toMatchObject({ level: 'error', category: 'errors' });
    expect(a.title).toContain('JS');
    expect(a.fields.callback_id).toBe('1');
  });

  it('routes card/charge types to campaign_billing with graded severity', () => {
    const alerts = evaluateCallbackAlerts(
      [
        ev('card_payment_failed'),
        ev('card_expired'),
        ev('card_expires_in_month'),
        ev('next_charge_alert', { insufficient_funds_amount: 2.5, required_money: 5 }),
      ],
      NOW,
    );
    expect(alerts.map((a) => [a.category, a.level])).toEqual([
      ['campaign_billing', 'error'],
      ['campaign_billing', 'warn'],
      ['campaign_billing', 'info'],
      ['campaign_billing', 'warn'],
    ]);
    expect(alerts[3].fields).toMatchObject({ insufficient_funds_amount: 2.5, required_money: 5 });
  });

  it('routes agreement types to send_health (expired is error, expiring is warn)', () => {
    const alerts = evaluateCallbackAlerts(
      [ev('expired_agreement', { document_count: 2 }), ev('expiring_agreement', { until_expiration: 20 })],
      NOW,
    );
    expect(alerts[0]).toMatchObject({ category: 'send_health', level: 'error' });
    expect(alerts[1]).toMatchObject({ category: 'send_health', level: 'warn' });
    expect(alerts[1].fields.until_expiration).toBe(20);
  });

  it('escalates expiring_callerid to error within 7 days, warn otherwise', () => {
    const near = evaluateCallbackAlerts([ev('expiring_callerid', { expiration_date: '2026-07-22' })], NOW);
    const far = evaluateCallbackAlerts([ev('expiring_callerid', { expiration_date: '2026-08-30' })], NOW);
    expect(near[0].level).toBe('error');
    expect(far[0].level).toBe('warn');
    // Only the count is ever present — never the actual numbers.
    const withCount = evaluateCallbackAlerts([ev('expiring_callerid', { callerid_count: 3 })], NOW);
    expect(withCount[0].fields.callerid_count).toBe(3);
  });

  it('treats a failed history report as warn, a successful one as info', () => {
    const failed = evaluateCallbackAlerts([ev('call_history_report', { success: 'false', history_report_id: 9 })], NOW);
    const ok = evaluateCallbackAlerts([ev('call_history_report', { success: 'true' })], NOW);
    expect(failed[0].level).toBe('warn');
    expect(ok[0].level).toBe('info');
  });

  it('marks certificate/SIP types as info-only (not applicable to KALFA)', () => {
    const alerts = evaluateCallbackAlerts(
      [ev('expiring_certificates', { certificate_count: 1 }), ev('sip_registration_fail', { sip_registration_count: 2 })],
      NOW,
    );
    expect(alerts.every((a) => a.level === 'info')).toBe(true);
  });

  it('EXCLUDES min_balance (handled by the verified pull) and unknown types', () => {
    const alerts = evaluateCallbackAlerts(
      [ev('min_balance'), ev('future_unknown_kind'), ev('js_fail')],
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('JS');
  });

  it('omits callback_id from fields when absent', () => {
    const [a] = evaluateCallbackAlerts([ev('js_fail', {}, null)], NOW);
    expect(a.fields.callback_id).toBeUndefined();
  });

  it('composes with the normalizer end-to-end (metadata-only, PII-free)', () => {
    const { events } = normalizeAccountCallbackEnvelope({
      callbacks: [
        {
          type: 'expiring_callerid',
          callback_id: 77,
          expiring_callerid: { expiration_date: '2026-07-21', callerids: ['+972500000009'] },
        },
        { type: 'min_balance', callback_id: 78, min_balance: { balance: 0.05 } },
      ],
    });
    const alerts = evaluateCallbackAlerts(events, NOW);
    // min_balance dropped; the CallerID event escalates (2 days out) and carries
    // the count + id, never the phone number.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'error', category: 'send_health' });
    expect(alerts[0].fields).toMatchObject({ callerid_count: 1, callback_id: '77' });
    expect(JSON.stringify(alerts)).not.toContain('972500000009');
  });
});
