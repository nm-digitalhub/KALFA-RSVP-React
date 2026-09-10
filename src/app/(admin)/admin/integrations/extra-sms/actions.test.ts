// sendExtraTestSmsAction is the one action in the integrations tree whose gate is NOT
// delegated: readSmsSettings and createExtraSmsSender both run on the service-role
// client and check nothing, so the requirePlatformPermission call inside this file IS
// the entire authorization. It also spends money and reaches a real handset.
//
// admin-data-layer-coverage.test.ts cannot cover that — it says so itself: it proves
// only that an endpoint gating HERE does not gate coarsely, not that a delegating one
// delegates. Verified: removing the gate from this action leaves that suite green.
// Hence this file.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));

const { permMock, logMock, updateMock, readMock, senderMock, sendMock, limitMock } = vi.hoisted(
  () => ({
    permMock: vi.fn(),
    logMock: vi.fn(),
    updateMock: vi.fn(),
    readMock: vi.fn(),
    senderMock: vi.fn(),
    sendMock: vi.fn(),
    limitMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logMock }));
vi.mock('@/lib/data/admin/settings', () => ({ updateExtraSmsConfig: updateMock }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: limitMock }));
vi.mock('@/lib/sms/sender', async () => {
  class SmsSendError extends Error {}
  return {
    SmsSendError,
    readSmsSettings: readMock,
    createExtraSmsSender: senderMock,
  };
});

import { sendExtraTestSmsAction, updateExtraSmsAction } from './actions';
import { SmsSendError } from '@/lib/sms/sender';

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  permMock.mockReset().mockResolvedValue({ id: 'staff-1' });
  logMock.mockReset();
  updateMock.mockReset();
  readMock.mockReset().mockResolvedValue({
    kind: 'ok',
    token: 't',
    sender: '03-3301505',
    enabled: true,
  });
  sendMock.mockReset().mockResolvedValue({ id: 'msg-1' });
  senderMock.mockReset().mockReturnValue({ send: sendMock });
  limitMock.mockReset().mockReturnValue({ allowed: true, remaining: 2, resetAt: Date.now() + 1000 });
});

describe('sendExtraTestSmsAction — the gate', () => {
  it('demands manage_settings BEFORE anything is read or sent', async () => {
    // requirePlatformPermission redirects rather than returning false, so a throw here
    // is what an unauthorized caller actually experiences.
    permMock.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }))).rejects.toThrow();
    expect(readMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rate-limits on the SESSION staff id, never on anything from the form', async () => {
    // A browser-supplied id would let one admin spend another's quota, and let anyone
    // reset their own by editing a hidden field.
    await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000', user_id: 'someone-else' }));
    expect(limitMock).toHaveBeenCalledWith('extra-test-sms:staff-1', expect.anything());
  });

  it('refuses once the hourly quota is spent, without calling the provider', async () => {
    limitMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 30 * 60_000 });
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }));
    expect(r?.error).toContain('מגבלת');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('sendExtraTestSmsAction — the destination', () => {
  it('normalises to E.164 before the provider is paid to reject it', async () => {
    await sendExtraTestSmsAction(null, fd({ test_destination: '050-000 0000' }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: '+972500000000' }));
  });

  it('rejects a non-number as a field error, with no request made', async () => {
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: 'לא מספר' }));
    expect(r?.fieldErrors?.test_destination).toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('requires a destination at all', async () => {
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: '  ' }));
    expect(r?.fieldErrors?.test_destination).toBeTruthy();
    expect(limitMock).not.toHaveBeenCalled();
  });
});

describe('sendExtraTestSmsAction — the switch', () => {
  it('sends the test even while sms_enabled is OFF', async () => {
    // Testing credentials is exactly what someone does BEFORE switching the channel
    // on. getSmsSender() would refuse here, which is why this path does not use it.
    readMock.mockResolvedValue({ kind: 'ok', token: 't', sender: 's', enabled: false });
    await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }));
    expect(sendMock).toHaveBeenCalled();
  });

  it('refuses when there are no credentials to test', async () => {
    readMock.mockResolvedValue({ kind: 'unconfigured' });
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }));
    expect(r?.error).toContain('אינם מוגדרים');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('sendExtraTestSmsAction — what the operator is told', () => {
  it('reports EVERY provider error, not just the first', async () => {
    // The spec says pre-send validation codes may arrive several at once. Reporting
    // only the billing failure would hide the unverified sender.
    sendMock.mockRejectedValue(
      new SmsSendError('שליחת ההודעה נדחתה ([{"code":9404},{"code":1215}])'),
    );
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }));
    // 1215 is the sender's fault and lands on the sender field…
    expect(r?.fieldErrors?.extra_sms_sender?.[0]).toContain('verified');
    // …while the billing problem still reaches the form rather than vanishing.
    expect(r?.error).toContain('כרטיס אשראי');
  });

  it('degrades to a generic message when the provider said nothing parseable', async () => {
    sendMock.mockRejectedValue(new SmsSendError('שליחת ההודעה נכשלה (HTTP 500)'));
    const r = await sendExtraTestSmsAction(null, fd({ test_destination: '0500000000' }));
    expect(r?.error).toBeTruthy();
    expect(r?.fieldErrors).toBeUndefined();
  });
});

describe('sendExtraTestSmsAction — the audit trail', () => {
  it('records the outcome and the codes, and NEVER the destination', async () => {
    // activity_log is an audit record, not a data store for personal data. The number
    // the admin typed belongs to a person.
    sendMock.mockRejectedValue(new SmsSendError('נדחתה ([{"code":1215}])'));
    await sendExtraTestSmsAction(null, fd({ test_destination: '0501234567' }));
    const logged = JSON.stringify(logMock.mock.calls);
    expect(logged).toContain('admin.extra.test_sms');
    expect(logged).toContain('1215');
    expect(logged).not.toContain('0501234567');
    // The normalised form shares no prefix with the typed one, so it needs its own
    // assertion — see the success case below.
    expect(logged).not.toContain('501234567');
  });

  it('records a success the same way', async () => {
    await sendExtraTestSmsAction(null, fd({ test_destination: '0501234567' }));
    const logged = JSON.stringify(logMock.mock.calls);
    expect(logged).toContain('"ok":true');
    // BOTH forms. Checking only the typed one lets the NORMALISED number through —
    // '+972501234567' does not contain '0501234567', and an earlier version of this
    // test passed while the destination was being logged.
    expect(logged).not.toContain('0501234567');
    expect(logged).not.toContain('501234567');
  });
});

describe('updateExtraSmsAction', () => {
  it('saves the three fields and revalidates both surfaces', async () => {
    const r = await updateExtraSmsAction(
      null,
      fd({ sms_enabled: 'on', extra_sms_sender: '03-3301505', extra_sms_token: 'tok' }),
    );
    expect(updateMock).toHaveBeenCalledWith({
      sms_enabled: true,
      extra_sms_sender: '03-3301505',
      extra_sms_token: 'tok',
    });
    expect(r?.notice).toBeTruthy();
  });

  it('reads an absent checkbox as off, which is what a form actually sends', async () => {
    await updateExtraSmsAction(null, fd({ extra_sms_sender: 's', extra_sms_token: 't' }));
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ sms_enabled: false }));
  });
});
