'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import {
  updateWhatsAppChannelConfig,
  updateWhatsAppConsentRequired,
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
  listVoximplantRules,
} from '@/lib/data/admin/voximplant-channel';
import {
  getOutreachMasterState,
  setOutreachEnabled,
} from '@/lib/data/admin/outreach-master';
import { updateChannelMetadata } from '@/lib/data/admin/channel-catalog';
import { saveOAuthProviderConfig } from '@/lib/data/admin/integrations/oauth-provider-config';
import { resolveProvider } from '@/lib/integrations/registry';
import { updateSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { sendSlackAlert } from '@/lib/alerts/slack';
import {
  createVoicePurpose,
  listVoicePurposesForAdmin,
  updateVoicePurpose,
} from '@/lib/data/admin/voice-purposes';
import { ruleIdAssignmentError, type RuleIdClaim } from '@/lib/validation/admin';
import type { VoximplantRulesResult } from '@/lib/data/admin/voximplant-channel';
import type { FormState } from '@/lib/validation/result';
import { sendPolicyFromFormData } from '@/lib/validation/send-policy-form';

// ─── WHERE A SAVE HAS TO BE REFLECTED ────────────────────────────────────────
// `revalidatePath` invalidates exactly the path it is handed. While these
// actions rendered on two surfaces (the old /admin/channels tabs and the
// provider pages that IMPORTED the same components), revalidating only
// '/admin/channels' left a save made from the new page showing its own pre-save
// values — a real defect that shipped with Task 0.3, not a hypothetical one.
// Task 0.6 Step 4b retired that page, so the legacy path is gone from these
// lists; every remaining entry names a route that still exists.
//
// Revalidating a path nobody is currently rendering costs nothing, so every
// surface is invalidated unconditionally. The index is included because its
// cards print `configured`/`enabled` for the very columns these actions write —
// and, since 4b, because it hosts the channel catalog itself.
//
// This module lives at /admin/integrations/actions.ts rather than beside one
// provider because its eleven actions span WhatsApp, Voximplant, the global
// outreach switch and the channel catalog. It moved here from the deleted
// /admin/channels/ directory; Next derives Server Action ids from module path +
// export name, so that move invalidated all eleven ids — which is what the
// .deploy-id version-skew guard exists to catch.
const INDEX = '/admin/integrations';
const META_WHATSAPP = '/admin/integrations/meta-whatsapp';
const VOXIMPLANT = '/admin/integrations/voximplant';
const WORKFLOW_OAUTH = '/admin/integrations/workflow-oauth';
// ⚠️ A DYNAMIC ROUTE, REVALIDATED BY ITS PATTERN. The workflow editor reads this
// provider's configuration to decide whether a node can offer "connect an
// account", and it can now open the provider form in a modal WITHOUT leaving the
// canvas — so a save made there has to be reflected on the page behind it.
// `'page'` is required: with a bracketed segment, `revalidatePath` treats the
// first argument as a literal path unless the type is given, and would match
// nothing.
const WORKFLOW_EDITOR = '/admin/workflows/[id]';

function revalidateAll(...paths: string[]): void {
  for (const path of paths) revalidatePath(path);
}

/** Every surface that reads the workflow OAuth provider, editor included. */
function revalidateWorkflowOAuth(): void {
  revalidateAll(WORKFLOW_OAUTH, INDEX);
  revalidatePath(WORKFLOW_EDITOR, 'page');
}

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

  revalidateAll(META_WHATSAPP, INDEX);
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
  // Both nullable text; '' unsets. Neither had an admin field before 2026-09-14
  // — see the note on VoximplantChannelConfig for what each one drives.
  voximplant_call_me_now_rule_id: z.string().trim().max(64).default(''),
  voximplant_application_id: z.string().trim().max(64).default(''),
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
    voximplant_call_me_now_rule_id:
      formData.get('voximplant_call_me_now_rule_id') ?? '',
    voximplant_application_id: formData.get('voximplant_application_id') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Both rule-id fields on this form go through the same one-rule-one-purpose
  // check. They are validated against each other too: `claims` carries the
  // STORED values, so submitting the same id in both boxes would pass the
  // pairwise test against storage — hence the explicit equality check first.
  const claims = await readRuleIdClaims();
  const baseRule = parsed.data.voximplant_rule_id.trim();
  const callMeNowRule = parsed.data.voximplant_call_me_now_rule_id.trim();
  if (baseRule !== '' && baseRule === callMeNowRule) {
    return {
      fieldErrors: {
        voximplant_call_me_now_rule_id: [
          'אותו Rule ID הוזן גם בשיחות RSVP וגם ב"חייג אליי עכשיו". כלל אחד יכול לשרת ייעוד אחד בלבד.',
        ],
      },
    };
  }
  for (const [field, value] of [
    ['voximplant_rule_id', baseRule],
    ['voximplant_call_me_now_rule_id', callMeNowRule],
  ] as const) {
    const err = ruleIdAssignmentError(value, field, claims);
    if (err) return { fieldErrors: { [field]: [err] } };
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

  revalidateAll(VOXIMPLANT, INDEX);
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

// Fetches the account's routing rules so the admin rule-id fields can offer a
// LIST instead of a free-text number. Not a form action: it takes no FormData
// and writes nothing — the client calls it from a button and renders the result
// itself, which is why it returns the rules rather than a FormState.
//
// Authorization lives in the DAL (requirePlatformPermission('manage_voice')),
// same as testVoximplantConnection; this wrapper only converts a thrown error
// into a message the panel can show.
export async function loadVoximplantRulesAction(): Promise<VoximplantRulesResult> {
  try {
    return await listVoximplantRules();
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, message: 'טעינת הכללים נכשלה' };
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
  revalidateAll(META_WHATSAPP, VOXIMPLANT, INDEX);
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
  revalidateAll(VOXIMPLANT, INDEX);
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
  revalidateAll(VOXIMPLANT);
  return {
    notice: required
      ? 'דרישת ההסכמה הופעלה — שיחות AI רק לאנשי קשר עם הסכמה מתועדת'
      : 'דרישת ההסכמה בוטלה — שיחות AI ייצאו גם ללא הסכמה מוקדמת (חשיפה משפטית — ראו האזהרה)',
  };
}

// Per-persona kill switches (2026-08-22) — meeting-confirm and sales-closing
// each get their OWN toggle+rule_id, deliberately separate from
// voximplant_live_calls/voximplant_rule_id (the RSVPAgent bridge rule,
// 1520915/`OutCallAgent`, must never carry another persona's calls). Rule
// 1494311 is `OutCall` — the DTMF `RSVP` scenario — and per CLAUDE.md no
// agent persona may point at it at all. Fail-closed exactly like updateVoximplantLiveCallsAction:
// refuses to enable without this persona's OWN rule_id AND the shared base
// config (service account + caller id). Checks the EFFECTIVE rule_id — the
// one being submitted in this same request, or the already-stored one if
// this submission leaves it blank — so "type a rule id and enable in one
// submit" and "enable using an already-saved rule id" both work.
// Every rule id currently claimed anywhere, so a save can refuse to hand one
// rule to a second purpose. Both reads gate on manage_voice internally, the same
// permission every caller here already holds.
//
// Built-in purposes are skipped: voice-purpose-dispatch.ts blocks them before
// they can dial (`if (purpose.isBuiltin) return blocked`) and the DAL never
// writes their rule_id, so their column is inert and must not reserve an id from
// a real purpose.
async function readRuleIdClaims(): Promise<RuleIdClaim[]> {
  const [cfg, purposes] = await Promise.all([
    getVoximplantChannelConfig(),
    listVoicePurposesForAdmin(),
  ]);
  return [
    { field: 'voximplant_rule_id', label: 'שיחות RSVP', ruleId: cfg.voximplant_rule_id },
    {
      field: 'voximplant_meeting_confirm_rule_id',
      label: 'שיחות אישור פגישה',
      ruleId: cfg.meetingConfirmRuleId,
    },
    {
      field: 'voximplant_sales_call_rule_id',
      label: 'שיחות סגירת מכירה',
      ruleId: cfg.salesCallRuleId,
    },
    {
      field: 'voximplant_call_me_now_rule_id',
      label: 'חייג אליי עכשיו',
      ruleId: cfg.voximplant_call_me_now_rule_id,
    },
    ...purposes
      .filter((p) => !p.isBuiltin)
      .map((p) => ({
        field: `voice_purpose:${p.key}`,
        label: `ייעוד השיחה "${p.displayName}"`,
        ruleId: p.ruleId,
      })),
  ];
}

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

  // One rule, one purpose — checked whether the persona is being switched on or
  // off, because the rule id is saved either way.
  const claimError = ruleIdAssignmentError(ruleId, ruleIdField, await readRuleIdClaims());
  if (claimError) return { fieldErrors: { [ruleIdField]: [claimError] } };

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
  revalidateAll(VOXIMPLANT);
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
  // The catalog editor renders in a section of the integrations index (Task 0.6
  // Step 4b gave it that home when /admin/channels was deleted), so the index is
  // the one surface that has to be re-rendered.
  revalidatePath(INDEX);
  return { notice: `הערוץ "${parsed.data.display_name}" נשמר` };
}

// Admin toggle for the WhatsApp CONSENT gate
// (app_settings.whatsapp_consent_required). The exact twin of
// updateCallConsentRequiredAction above, deliberately mirrored so the two
// outreach channels cannot drift in behaviour, wording, or audit trail.
//
// The checkbox is "require explicit consent"; DEFAULT is on (SAFE). Turning it
// OFF permits WhatsApp templates to contacts with NO recorded
// contacts.whatsapp_consent_at — Israeli spam-law exposure, an owner/legal
// decision, not a technical one. Opt-out (removal_requested), the frozen
// campaign_authorized_contacts set, and fail-closed reads still apply.
// Emits a SECURITY Slack audit on every flip. requireAdmin is enforced inside
// updateWhatsAppConsentRequired (manage_settings).
export async function updateWhatsAppConsentRequiredAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const required = formData.get('whatsapp_consent_required') === 'on';
  try {
    await updateWhatsAppConsentRequired(required);
  } catch (err) {
    unstable_rethrow(err);
    return { error: 'עדכון מתג ההסכמה לוואטסאפ נכשל. נסו שוב.' };
  }
  // Turning the requirement OFF is the security-relevant event — alert on both,
  // but make the lifted-consent case unmistakable.
  void sendSlackAlert({
    level: required ? 'info' : 'warn',
    category: 'security',
    source: 'whatsapp-consent-toggle',
    title: required
      ? 'WhatsApp consent requirement RE-ENABLED'
      : 'WhatsApp consent requirement LIFTED — sending without prior consent permitted',
    fields: { consent_required: String(required) },
  });
  revalidateAll(META_WHATSAPP);
  return {
    notice: required
      ? 'דרישת ההסכמה הופעלה — הודעות וואטסאפ רק לאנשי קשר עם הסכמה מתועדת'
      : 'דרישת ההסכמה בוטלה — הודעות וואטסאפ ייצאו גם ללא הסכמה מוקדמת (חשיפה משפטית — ראו האזהרה)',
  };
}

// ─── SEND POLICY (G9) ────────────────────────────────────────────────────────
// updateSendPolicy (manage_settings). The send-timing window every campaign is
// scheduled against; until now it was editable only in SQL.
//
// Thin on purpose. Form → policy is a PURE function (sendPolicyFromFormData) so
// the ceiling rejections can be tested without a Server Action runtime, and the
// ceilings themselves live in parseSendPolicy, which both that function and the
// DAL call. This action decides nothing about what a legal window is.
export async function updateSendPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = sendPolicyFromFormData(formData);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors };

  try {
    await updateSendPolicy(parsed.policy);
  } catch (err) {
    unstable_rethrow(err);
    // The DAL re-validates, so a throw here is a write failure or a gate
    // rejection — not a rejected window, which never reaches this line.
    return { error: 'שמירת מדיניות השליחה נכשלה. נסו שוב.' };
  }

  revalidateAll(META_WHATSAPP);
  return { notice: 'מדיניות השליחה נשמרה' };
}

// ---------------------------------------------------------------------------
// Voice purposes — the registry that lets a NEW agent be used without new code
// ---------------------------------------------------------------------------
//
// ⚠️ A ROW HERE CAN TELEPHONE PEOPLE, which is why both actions are narrow. The
// key is validated against the same shape the table's CHECK enforces, a new
// purpose is always created switched OFF, and the rule id is trimmed and length
// bounded before it can ever reach `StartScenarios`.

const voicePurposeKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,48}$/, 'המזהה חייב להיות באנגלית קטנה, ספרות וקו תחתון');

const createVoicePurposeSchema = z.object({
  key: voicePurposeKeySchema,
  displayName: z.string().trim().min(2, 'נא למלא שם').max(120),
  description: z.string().trim().max(500).default(''),
  ruleId: z.string().trim().max(64).default(''),
});

export async function createVoicePurposeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createVoicePurposeSchema.safeParse({
    key: formData.get('key') ?? '',
    displayName: formData.get('displayName') ?? '',
    description: formData.get('description') ?? '',
    ruleId: formData.get('ruleId') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const createClaimError = ruleIdAssignmentError(
    parsed.data.ruleId,
    `voice_purpose:${parsed.data.key}`,
    await readRuleIdClaims(),
  );
  if (createClaimError) return { fieldErrors: { ruleId: [createClaimError] } };

  try {
    await createVoicePurpose(parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'יצירת הייעוד נכשלה' };
  }

  revalidateAll(VOXIMPLANT);
  return { notice: 'הייעוד נוצר — כבוי. הפעילו אותו אחרי שווידאתם את ה-Rule ID.' };
}

const updateVoicePurposeSchema = z.object({
  key: voicePurposeKeySchema,
  displayName: z.string().trim().min(2, 'נא למלא שם').max(120),
  description: z.string().trim().max(500).default(''),
  ruleId: z.string().trim().max(64).default(''),
  enabled: z.boolean(),
  active: z.boolean(),
});

export async function updateVoicePurposeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const enabled = formData.get('enabled') === 'on';
  const ruleId = String(formData.get('ruleId') ?? '').trim();

  // ⚠️ FAIL CLOSED ON "ENABLE WITHOUT A RULE", the same rule the persona
  // switches already follow. An enabled purpose with no rule cannot dial, and
  // the failure would arrive as a run-log line hours later instead of here.
  if (enabled && ruleId === '') {
    return { error: 'לא ניתן להפעיל ייעוד ללא Rule ID של תרחיש Voximplant.' };
  }

  const parsed = updateVoicePurposeSchema.safeParse({
    key: formData.get('key') ?? '',
    displayName: formData.get('displayName') ?? '',
    description: formData.get('description') ?? '',
    ruleId,
    enabled,
    active: formData.get('active') === 'on',
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  // Own field is keyed by the purpose key, so re-saving a purpose with the rule
  // it already holds is allowed; taking another purpose's rule is not.
  const updateClaimError = ruleIdAssignmentError(
    parsed.data.ruleId,
    `voice_purpose:${parsed.data.key}`,
    await readRuleIdClaims(),
  );
  if (updateClaimError) return { fieldErrors: { ruleId: [updateClaimError] } };

  try {
    await updateVoicePurpose(parsed.data);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'עדכון הייעוד נכשל' };
  }

  revalidateAll(VOXIMPLANT);
  return { notice: enabled ? 'הייעוד מופעל — שיחות אמיתיות מותרות' : 'הייעוד עודכן' };
}

// ---------------------------------------------------------------------------
// Workflow integration OAuth — this deployment's client registration.
// ---------------------------------------------------------------------------

/**
 * Save the OAuth client a workflow integration authorizes against.
 *
 * NO OAUTH LOGIC LIVES HERE. This reads a form, validates it, and hands over —
 * the flow, the scopes, PKCE and the state row are all in `src/lib/integrations`,
 * and the write itself is in the data module so that this stays the thin layer
 * the project's other actions are.
 *
 * ⚠️ AN EMPTY CLIENT SECRET IS VALID AND IS NOT VALIDATED AGAINST. The RPC's
 * contract is that '' on an existing row KEEPS the stored secret, and that a
 * first write without one is refused. Rejecting a blank secret here would look
 * like a safety check while actually breaking the ordinary case — correcting a
 * client id, or flipping `enabled` — for an operator who no longer holds a
 * secret that was only ever displayed once by the provider.
 *
 * The first-write case is left to the database, which is the only place that
 * knows whether a row already exists at the moment of writing. A local check
 * would be a guess made one round-trip earlier.
 */
export async function saveWorkflowOAuthProviderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const provider = String(formData.get('provider') ?? '').trim();
  const clientId = String(formData.get('clientId') ?? '').trim();
  const clientSecret = String(formData.get('clientSecret') ?? '').trim();
  const enabled = formData.get('enabled') === 'on';

  const fieldErrors: Record<string, string[]> = {};

  // ⚠️ `provider` IS VALIDATED AGAINST THE REGISTRY, NOT HARDCODED AND NOT
  // TRUSTED. Hardcoding one vendor here would mean a second action per provider,
  // which is the coupling this whole layer exists to avoid; trusting the field
  // would let a browser create a configuration row for an id nothing can ever
  // use. The registry is the list of providers that exist, so it is the list a
  // configuration may name — and a provider with no `oauth` block has no client
  // to configure at all.
  const definition = provider ? resolveProvider(provider) : undefined;
  if (!definition?.oauth) {
    fieldErrors.provider = ['ספק לא ידוע או שאינו משתמש ב-OAuth.'];
  }
  if (!clientId) {
    fieldErrors.clientId = ['יש להזין Client ID.'];
  }
  // The provider condition is repeated rather than inferred: both fields are
  // collected first so the form can report them together, and this is what
  // narrows `definition` for the call below.
  if (!definition?.oauth || Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  try {
    // `requirePlatformPermission('integrations.manage')` runs INSIDE, and its
    // refusal is a redirect() — a throw that `unstable_rethrow` below lets back
    // out rather than converting into a form error.
    // `definition.id`, not the raw field — the registry's own spelling is what
    // every other layer looks a provider up by.
    await saveOAuthProviderConfig({
      provider: definition.id,
      clientId,
      clientSecret,
      enabled,
    });
  } catch (error) {
    unstable_rethrow(error);
    return { error: 'לא ניתן היה לשמור את הגדרות ה-OAuth. בדקו את הפרטים ונסו שוב.' };
  }

  revalidateWorkflowOAuth();
  // Neutral on purpose. The RPC returns void, so "created" and "updated" are not
  // distinguishable — and inventing the distinction would mean widening a
  // contract to phrase a sentence.
  return { notice: 'הגדרות ה-OAuth נשמרו.' };
}
