'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import {
  updateAppSettings,
  setBaseOveragePricingEnabled,
  setExchangeConnectionMode,
  type ExchangeConnectionMode,
} from '@/lib/data/admin/settings';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import { BASE_FEE_AGREEMENT_VERSION } from '@/lib/agreements/template';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { appSettingsSchema } from '@/lib/validation/admin';
import type { FormState } from '@/lib/validation/result';

export async function updateSettingsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = appSettingsSchema.safeParse({
    // A checkbox is present ('on') only when checked; absent means off.
    payments_enabled: formData.get('payments_enabled') === 'on',
    close_charge_enabled: formData.get('close_charge_enabled') === 'on',
    sumit_company_id: formData.get('sumit_company_id') ?? '',
    sumit_api_public_key: formData.get('sumit_api_public_key') ?? '',
    sumit_api_key: formData.get('sumit_api_key') ?? '',
    sms_enabled: formData.get('sms_enabled') === 'on',
    extra_sms_sender: formData.get('extra_sms_sender') ?? '',
    extra_sms_token: formData.get('extra_sms_token') ?? '',
    email_enabled: formData.get('email_enabled') === 'on',
    smtp_host: formData.get('smtp_host') ?? '',
    smtp_port: formData.get('smtp_port') ?? '',
    smtp_secure: formData.get('smtp_secure') === 'on',
    smtp_user: formData.get('smtp_user') ?? '',
    smtp_password: formData.get('smtp_password') ?? '',
    smtp_from: formData.get('smtp_from') ?? '',
    inquiry_followup_enabled: formData.get('inquiry_followup_enabled') === 'on',
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateAppSettings(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון ההגדרות נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/settings');
  return { notice: 'ההגדרות נשמרו' };
}

// The base+overage pricing gate toggle. Enabling turns on real ₪200 activation-
// fee billing for NEW campaigns, so it is FAIL-CLOSED: refuse to enable unless the
// ACTIVE agreement is the APPROVED v4 base-fee contract — so new signers actually
// agree to the base fee and the close-charge D5 guard has a matching signature to
// honor. A security audit is emitted on every flip. (Disabling is always allowed.)
export async function updateBaseOveragePricingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('base_overage_pricing_enabled') === 'on';
  if (enabled) {
    const doc = await getActiveAgreementDoc();
    if (doc.version !== BASE_FEE_AGREEMENT_VERSION || doc.status !== 'approved') {
      return {
        error:
          'לא ניתן להפעיל את התמחור המדורג עד שהסכם דמי-ההפעלה (v4) פעיל ומאושר תחת /admin/agreement.',
      };
    }
  }
  try {
    await setBaseOveragePricingEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג התמחור המדורג נכשל. נסו שוב.' };
  }
  // Security audit on every flip (fire-and-forget, never throws).
  void sendSlackAlert({
    level: enabled ? 'warn' : 'info',
    category: 'security',
    source: 'base-overage-pricing-toggle',
    title: enabled
      ? 'Base+overage pricing ENABLED — ₪200 activation fee now billed on new campaigns'
      : 'Base+overage pricing disabled — back to per-reached',
    fields: { enabled: String(enabled) },
  });
  revalidatePath('/admin/settings');
  return {
    notice: enabled
      ? 'התמחור המדורג הופעל — קמפיינים חדשים יחויבו בדמי הפעלה ₪200'
      : 'התמחור המדורג כובה — חזרה לחיוב לפי-תוצאה',
  };
}

// Ownership-model switch for Exchange (EWS) connections (plan §3.1). Does NOT
// touch existing exchange_connections rows — only which mode new connections
// are created under and which UI path /app/settings shows.
export async function updateExchangeConnectionModeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formData.get('exchange_connection_mode');
  const mode: ExchangeConnectionMode = raw === 'per_org' ? 'per_org' : 'per_user';
  try {
    await setExchangeConnectionMode(mode);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מצב הבעלות של Exchange נכשל. נסו שוב.' };
  }
  revalidatePath('/admin/settings');
  revalidatePath('/app/settings');
  return {
    notice:
      mode === 'per_org'
        ? 'מצב הבעלות עודכן: חיבורי Exchange חדשים ישויכו לארגון.'
        : 'מצב הבעלות עודכן: חיבורי Exchange חדשים ישויכו למשתמש המחבר.',
  };
}
