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
  updateMeetingConfirmChannel,
  updateSalesCallChannel,
} from '@/lib/data/admin/voximplant-channel';
import {
  getOutreachMasterState,
  setOutreachEnabled,
} from '@/lib/data/admin/outreach-master';
import { updateChannelMetadata } from '@/lib/data/admin/channel-catalog';
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

// Per-persona kill switches (2026-08-22) — meeting-confirm and sales-closing
// each get their OWN toggle+rule_id, deliberately separate from
// voximplant_live_calls/voximplant_rule_id (RSVPAgent's OutCall rule,
// 1494311, must never carry another persona's calls — see the migration's
// own comment). Fail-closed exactly like updateVoximplantLiveCallsAction:
// refuses to enable without this persona's OWN rule_id AND the shared base
// config (service account + caller id). Checks the EFFECTIVE rule_id — the
// one being submitted in this same request, or the already-stored one if
// this submission leaves it blank — so "type a rule id and enable in one
// submit" and "enable using an already-saved rule id" both work.
const personaChannelSchema = z.object({
  ruleId: z.string().trim().max(64).default(''),
  enabled: z.boolean(),
});

async function updatePersonaChannel(
  formData: FormData,
  ruleIdField: string,
  enabledField: string,
  update: (input: { ruleId: string; enabled: boolean }) => Promise<void>,
  slackSource: string,
  errors: {
    enableWithoutRule: string;
    updateFailed: string;
    onNotice: string;
    offNotice: string;
    onTitle: string;
    offTitle: string;
  },
): Promise<FormState> {
  const parsed = personaChannelSchema.safeParse({
    ruleId: formData.get(ruleIdField) ?? '',
    enabled: formData.get(enabledField) === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { ruleId, enabled } = parsed.data;

  // ruleId is ALWAYS what was submitted (the field is defaultValue-pre-filled
  // in the UI, not blank-means-keep) — so the submitted value IS the
  // effective one, no separate stored-value fallback needed here.
  if (enabled) {
    const cfg = await getVoximplantChannelConfig(); // requireAdmin inside
    const baseConfigured = cfg.serviceAccountConfigured && !!cfg.voximplant_caller_id;
    if (!baseConfigured || !ruleId) {
      return { error: errors.enableWithoutRule };
    }
  }

  try {
    await update({ ruleId, enabled });
  } catch (err) {
    unstable_rethrow(err);
    return { error: errors.updateFailed };
  }
  void sendSlackAlert({
    level: enabled ? 'warn' : 'info',
    category: 'security',
    source: slackSource,
    title: enabled ? errors.onTitle : errors.offTitle,
    fields: { enabled: String(enabled) },
  });
  revalidatePath('/admin/channels');
  return { notice: enabled ? errors.onNotice : errors.offNotice };
}

export async function updateMeetingConfirmChannelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return updatePersonaChannel(
    formData,
    'voximplant_meeting_confirm_rule_id',
    'voximplant_meeting_confirm_enabled',
    updateMeetingConfirmChannel,
    'voximplant-meeting-confirm-toggle',
    {
      enableWithoutRule:
        'לא ניתן להפעיל שיחות אישור פגישה ללא Rule ID לסוכן זה וחשבון Voximplant בסיסי מוגדר (חשבון שירות ומספר יוצא).',
      updateFailed: 'עדכון הגדרות סוכן אישור הפגישה נכשל. נסו שוב.',
      onNotice: 'שיחות אישור פגישה מופעלות',
      offNotice: 'שיחות אישור פגישה כבויות',
      onTitle: 'Voximplant meeting-confirm calls ENABLED — real paid dialing permitted',
      offTitle: 'Voximplant meeting-confirm calls disabled',
    },
  );
}

export async function updateSalesCallChannelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return updatePersonaChannel(
    formData,
    'voximplant_sales_call_rule_id',
    'voximplant_sales_calls_enabled',
    updateSalesCallChannel,
    'voximplant-sales-call-toggle',
    {
      enableWithoutRule:
        'לא ניתן להפעיל שיחות סגירת מכירה ללא Rule ID לסוכן זה וחשבון Voximplant בסיסי מוגדר (חשבון שירות ומספר יוצא).',
      updateFailed: 'עדכון הגדרות סוכן סגירת המכירה נכשל. נסו שוב.',
      onNotice: 'שיחות סגירת מכירה מופעלות',
      offNotice: 'שיחות סגירת מכירה כבויות',
      onTitle: 'Voximplant sales-closing calls ENABLED — real paid dialing permitted',
      offTitle: 'Voximplant sales-closing calls disabled',
    },
  );
}

// Edit ONE existing channel's display metadata (label / built-flag / show-hide /
// order) in the channel catalog (public.channels). `key` is immutable and there
// is no create/delete — adding a channel is a schema+code concern, not a metadata
// edit (see the DAL note + plans/channels-data-driven-plan.md). manage_settings +
// admin RLS enforced in the DAL.
const channelCatalogSchema = z.object({
  key: z.string().trim().min(1).max(64),
  display_name: z.string().trim().min(1, { error: 'שם תצוגה חובה' }).max(64),
  is_built: z.boolean(),
  active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});

export async function updateChannelCatalogAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = channelCatalogSchema.safeParse({
    key: formData.get('key') ?? '',
    display_name: formData.get('display_name') ?? '',
    // Unchecked checkboxes are absent from FormData → false.
    is_built: formData.get('is_built') === 'on',
    active: formData.get('active') === 'on',
    sort_order: (formData.get('sort_order') || '0') as string,
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await updateChannelMetadata(parsed.data);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון הערוץ נכשל. נסו שוב.' };
  }
  revalidatePath('/admin/channels');
  return { notice: `הערוץ "${parsed.data.display_name}" נשמר` };
}
