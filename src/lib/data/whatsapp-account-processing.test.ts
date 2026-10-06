import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let wabaId: string | null = 'waba-ours';
vi.mock('@/lib/data/outreach-config', () => ({
  getWhatsAppConfig: async () => (wabaId === null ? null : { wabaId }),
}));

const sendSlackAlert = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args) }));

import {
  processAccountReviewRow,
  processAccountUpdateRow,
  processPhoneNumberQualityRow,
} from './whatsapp-account-processing';

type Row = Parameters<typeof processAccountReviewRow>[0];
const row = (payload: Record<string, unknown>) => ({ id: 'row-1', payload }) as unknown as Row;
const alert = () => sendSlackAlert.mock.calls[0]?.[0] as Record<string, unknown> & { fields: Record<string, string> };

beforeEach(() => {
  vi.clearAllMocks();
  wabaId = 'waba-ours';
});

describe('account_review_update', () => {
  it('reports APPROVED as information', async () => {
    await processAccountReviewRow(row({ decision: 'APPROVED', entry_waba_id: 'waba-ours' }));
    expect(alert()).toMatchObject({ level: 'info', title: 'סקירת חשבון WhatsApp הפעיל ב-Meta: אושר' });
  });

  it.each(['REJECTED', 'PENDING', 'DEFERRED'])('reports %s as an error — the account cannot send', async (decision) => {
    await processAccountReviewRow(row({ decision, entry_waba_id: 'waba-ours' }));
    expect(alert()).toMatchObject({ level: 'error' });
    expect(alert().detail).toContain('לא מאפשרת לשלוח');
  });

  it('reports a decision Meta adds later under its own name', async () => {
    await processAccountReviewRow(row({ decision: 'SOMETHING_NEW' }));
    expect(alert()).toMatchObject({ level: 'error', title: 'סקירת חשבון WhatsApp הפעיל ב-Meta: SOMETHING_NEW' });
  });

  it("skips Meta's dashboard test sample (entry id 0)", async () => {
    await processAccountReviewRow(row({ decision: 'REJECTED', entry_waba_id: '0' }));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('names another account by its id', async () => {
    await processAccountReviewRow(row({ decision: 'REJECTED', entry_waba_id: 'waba-other' }));
    expect(alert().title).toContain('חשבון WhatsApp אחר (waba-other)');
  });

  it('treats a row stored without the WABA id as ours', async () => {
    await processAccountReviewRow(row({ decision: 'APPROVED' }));
    expect(alert().title).toContain('חשבון WhatsApp הפעיל');
  });

  it('ignores a malformed payload', async () => {
    await processAccountReviewRow(row({ nope: true }));
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('account_update', () => {
  it('reports a ban (DISABLED_UPDATE / DISABLE) as an error with its date', async () => {
    await processAccountUpdateRow(
      row({ event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: 'DISABLE', waba_ban_date: 'April 17, 2025' } }),
    );
    expect(alert()).toMatchObject({ level: 'error', title: 'חשבון WhatsApp הפעיל: החשבון הושבת' });
    expect(alert().fields).toMatchObject({ ban_state: 'DISABLE', ban_date: 'April 17, 2025' });
  });

  it('reports a reinstatement as information', async () => {
    await processAccountUpdateRow(row({ event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: 'REINSTATE' } }));
    expect(alert()).toMatchObject({ level: 'info', title: 'חשבון WhatsApp הפעיל: החשבון הוחזר לפעילות' });
  });

  it('reports a restriction with its types and Meta remediation text', async () => {
    await processAccountUpdateRow(
      row({
        event: 'ACCOUNT_RESTRICTION',
        restriction_info: [
          {
            restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING',
            expiration: 1641330498,
            remediation: 'Review your messaging practices and ensure compliance with WhatsApp policies.',
          },
        ],
      }),
    );
    expect(alert()).toMatchObject({ level: 'error', title: 'חשבון WhatsApp הפעיל: החשבון הוגבל' });
    expect(alert().fields.restrictions).toBe('RESTRICTED_BIZ_INITIATED_MESSAGING');
    expect(alert().detail).toContain('Review your messaging practices');
  });

  it('reports a violation with its type', async () => {
    await processAccountUpdateRow(row({ event: 'ACCOUNT_VIOLATION', violation_info: { violation_type: 'ADULT' } }));
    expect(alert()).toMatchObject({ level: 'error' });
    expect(alert().fields.violation).toBe('ADULT');
  });

  it('reports an unknown event at information level under its own name', async () => {
    await processAccountUpdateRow(row({ event: 'BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE', country: 'IL' }));
    expect(alert()).toMatchObject({
      level: 'info',
      title: 'חשבון WhatsApp הפעיל: עדכון חשבון: BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE',
    });
  });
});

describe('phone_number_quality_update', () => {
  it('reports the new daily limit from max_daily_conversations_per_business', async () => {
    await processPhoneNumberQualityRow(
      row({
        display_phone_number: '15550783881',
        event: 'THROUGHPUT_UPGRADE',
        max_daily_conversations_per_business: 'TIER_2K',
      }),
    );
    expect(alert()).toMatchObject({
      level: 'info',
      title: 'מכסת השליחה היומית של מספר WhatsApp השתנתה: 2,000 ביום',
    });
    expect(alert().fields).toMatchObject({ event: 'THROUGHPUT_UPGRADE', limit: 'TIER_2K' });
  });

  it('falls back to the retired current_limit', async () => {
    await processPhoneNumberQualityRow(row({ event: 'DOWNGRADE', current_limit: 'TIER_250', old_limit: 'TIER_2K' }));
    expect(alert().title).toContain('250 ביום');
    expect(alert().fields.previous).toBe('TIER_2K');
  });
});
