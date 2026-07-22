'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  updateWhatsAppChannelConfig,
  testWhatsAppConnection,
} from '@/lib/data/admin/channels';
import {
  getVoximplantChannelConfig,
  updateVoximplantChannelConfig,
  testVoximplantConnection,
  updateVoximplantLiveCalls,
  updateCallConsentRequired,
} from '@/lib/data/admin/voximplant-channel';
import {
  getOutreachMasterState,
  setOutreachEnabled,
} from '@/lib/data/admin/outreach-master';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { FormState } from '@/lib/validation/result';

// Form-friendly: every field is an optional string; the master toggle is a
// checkbox. Trimmed; '' is an intentional unset (mapped to null in the DAL).
const whatsappChannelSchema = z.object({
  whatsapp_phone_number_id: z.string().trim().max(64).default(''),
  whatsapp_waba_id: z.string().trim().max(64).default(''),
  whatsapp_access_token: z.string().trim().max(512).default(''),
  whatsapp_app_secret: z.string().trim().max(256).default(''),
  whatsapp_verify_token: z.string().trim().max(256).default(''),
});

export async function updateWhatsAppChannelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = whatsappChannelSchema.safeParse({
    whatsapp_phone_number_id: formData.get('whatsapp_phone_number_id') ?? '',
    whatsapp_waba_id: formData.get('whatsapp_waba_id') ?? '',
    whatsapp_access_token: formData.get('whatsapp_access_token') ?? '',
    whatsapp_app_secret: formData.get('whatsapp_app_secret') ?? '',
    whatsapp_verify_token: formData.get('whatsapp_verify_token') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // This form only persists WhatsApp config. The global outreach switch is owned
  // solely by updateOutreachMasterSwitchAction — this action no longer reads or
  // writes `outreach_enabled` (dropping it here + from the DAL SET prevents every
  // WhatsApp save from clobbering the shared switch to false).
  try {
    await updateWhatsAppChannelConfig(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/channels');
  return { notice: 'הגדרות הערוץ נשמרו' };
}

export async function testWhatsAppConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const r = await testWhatsAppConnection();
    return r.ok ? { notice: r.message } : { error: r.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'בדיקת החיבור נכשלה' };
  }
}

// Form-friendly: every field optional string; '' is an intentional unset (DAL
// maps to null, except the write-only service-account JSON which '' leaves
// untouched).
const voximplantChannelSchema = z.object({
  voximplant_service_account_json: z.string().trim().max(8192).default(''),
  voximplant_rule_id: z.string().trim().max(64).default(''),
  voximplant_caller_id: z.string().trim().max(32).default(''),
  voximplant_callback_secret: z.string().trim().max(256).default(''),
  voximplant_low_balance_threshold: z.string().trim().max(16).default(''),
  voximplant_min_call_reserve: z.string().trim().max(16).default(''),
  voximplant_max_concurrent_calls: z.string().trim().max(8).default(''),
  voximplant_max_calls_per_campaign_hour: z.string().trim().max(8).default(''),
});

export async function updateVoximplantChannelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = voximplantChannelSchema.safeParse({
    voximplant_service_account_json:
      formData.get('voximplant_service_account_json') ?? '',
    voximplant_rule_id: formData.get('voximplant_rule_id') ?? '',
    voximplant_caller_id: formData.get('voximplant_caller_id') ?? '',
    voximplant_callback_secret: formData.get('voximplant_callback_secret') ?? '',
    voximplant_low_balance_threshold:
      formData.get('voximplant_low_balance_threshold') ?? '',
    voximplant_min_call_reserve:
      formData.get('voximplant_min_call_reserve') ?? '',
    voximplant_max_concurrent_calls:
      formData.get('voximplant_max_concurrent_calls') ?? '',
    voximplant_max_calls_per_campaign_hour:
      formData.get('voximplant_max_calls_per_campaign_hour') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // No enable-guard here: this form only persists Voximplant config. The global
  // switch is owned by updateOutreachMasterSwitchAction, whose own guard ("≥1
  // channel configured") reads THIS saved config's `configured` flag.
  try {
    await updateVoximplantChannelConfig(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הגדרות הערוץ נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/channels');
  return { notice: 'הגדרות הערוץ נשמרו' };
}

export async function testVoximplantConnectionAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const r = await testVoximplantConnection();
    return r.ok ? { notice: r.message } : { error: r.message };
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'בדיקת החיבור נכשלה' };
  }
}

// The SOLE writer of the shared `outreach_enabled` master switch. Fail-closed
// server-side (never trust the client): enabling requires ≥1 configured channel.
export async function updateOutreachMasterSwitchAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('outreach_enabled') === 'on';
  if (enabled) {
    const state = await getOutreachMasterState(); // requireAdmin inside; re-checks readiness server-side
    if (!state.anyChannelReady) {
      return {
        error:
          'לא ניתן להפעיל פנייה ללא ערוץ מוגדר אחד לפחות. הגדירו ושמרו ערוץ תחילה.',
      };
    }
  }
  try {
    await setOutreachEnabled(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג הפנייה נכשל. נסו שוב.' };
  }
  revalidatePath('/admin/channels');
  return { notice: enabled ? 'פנייה לאורחים מופעלת' : 'פנייה לאורחים כבויה' };
}

// Admin toggle for the LIVE-DIAL gate (app_settings.voximplant_live_calls).
// Enabling PERMITS real, paid outbound calls. Fail-closed: refuses to enable
// without a complete dial config (SA + rule + caller + callback).
// Emits a SECURITY Slack audit on every flip. The env VOXIMPLANT_LIVE_CALLS
// ='false' still hard-overrides regardless of this toggle. requireAdmin is
// enforced in getVoximplantChannelConfig + updateVoximplantLiveCalls.
export async function updateVoximplantLiveCallsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('voximplant_live_calls') === 'on';
  if (enabled) {
    const cfg = await getVoximplantChannelConfig(); // requireAdmin inside
    if (!cfg.fullyConfigured) {
      return {
        error:
          'לא ניתן להפעיל שיחות חיות ללא קונפיג מלא — חשבון שירות, Rule ID, מספר יוצא ו-Callback Secret.',
      };
    }
  }
  try {
    await updateVoximplantLiveCalls(enabled);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג השיחות החיות נכשל. נסו שוב.' };
  }
  // Reliable security audit (fire-and-forget; never throws).
  void sendSlackAlert({
    level: 'warn',
    category: 'security',
    source: 'voximplant-live-toggle',
    title: enabled
      ? 'Voximplant LIVE CALLS enabled — real paid dialing permitted'
      : 'Voximplant live calls disabled',
    fields: { enabled: String(enabled) },
  });
  revalidatePath('/admin/channels');
  return {
    notice: enabled
      ? 'שיחות חיות מופעלות — שיחות בתשלום ייצאו לאנשי קשר שנתנו הסכמה'
      : 'שיחות חיות כובו',
  };
}

// Admin toggle for the AI-call CONSENT gate (app_settings.call_consent_required).
// The checkbox is "require explicit consent"; DEFAULT is on (SAFE). Turning it OFF
// permits AI dials to contacts with NO recorded prior consent — spam-law exposure,
// an owner/legal decision. opt-out + DNC + fail-closed still apply. Emits a
// SECURITY Slack audit on every flip. requireAdmin is enforced inside
// updateCallConsentRequired (manage_voice).
export async function updateCallConsentRequiredAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const required = formData.get('call_consent_required') === 'on';
  try {
    await updateCallConsentRequired(required);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג ההסכמה נכשל. נסו שוב.' };
  }
  // Turning the requirement OFF is the security-relevant event — alert on both,
  // but make the lifted-consent case unmistakable.
  void sendSlackAlert({
    level: required ? 'info' : 'warn',
    category: 'security',
    source: 'call-consent-toggle',
    title: required
      ? 'AI-call consent requirement RE-ENABLED'
      : 'AI-call consent requirement LIFTED — dialing without prior consent permitted',
    fields: { consent_required: String(required) },
  });
  revalidatePath('/admin/channels');
  return {
    notice: required
      ? 'דרישת ההסכמה הופעלה — שיחות AI רק לאנשי קשר עם הסכמה מתועדת'
      : 'דרישת ההסכמה בוטלה — שיחות AI ייצאו גם ללא הסכמה מוקדמת (חשיפה משפטית — ראו האזהרה)',
  };
}
