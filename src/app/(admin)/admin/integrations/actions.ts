'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import {
  updateWhatsAppChannelConfig,
  testWhatsAppConnection,
} from '@/lib/data/admin/channels';
import {
  getVoximplantChannelConfig,
  updateVoximplantChannelConfig,
  testVoximplantConnection,
  updateVoximplantLiveCalls,
  updateMeetingConfirmChannel,
  updateSalesCallChannel,
  listVoximplantRules,
} from '@/lib/data/admin/voximplant-channel';
import {
  getOutreachMasterState,
  setOutreachEnabled,
} from '@/lib/data/admin/outreach-master';
import { updateChannelMetadata } from '@/lib/data/admin/channel-catalog';
import { updateSendPolicy } from '@/lib/data/admin/integrations/send-policy';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { ruleIdAssignmentError, type RuleIdClaim } from '@/lib/validation/admin';
import type { VoximplantRulesResult } from '@/lib/data/admin/voximplant-channel';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { sendPolicyFromFormData } from '@/lib/validation/send-policy-form';

// ─── WHERE A SAVE HAS TO BE REFLECTED ────────────────────────────────────────
// `revalidatePath` invalidates exactly the path it is handed, so a save is
// reflected only on the surfaces named here.
//
// Revalidating a path nobody is currently rendering costs nothing, so every
// surface is invalidated unconditionally. The index is included because its
// cards print `configured`/`enabled` for the very columns these actions write —
// and because it hosts the channel catalog itself.
//
// This module lives at /admin/integrations/actions.ts rather than beside one
// provider because its actions span WhatsApp, Voximplant, the global outreach
// switch, the channel catalog and the send policy. Next derives Server Action
// ids from module path + export name, so moving this module invalidates every
// action id in it — which is what the .deploy-id version-skew guard exists to
// catch.
const INDEX = '/admin/integrations';
const META_WHATSAPP = '/admin/integrations/meta-whatsapp';
const VOXIMPLANT = '/admin/integrations/voximplant';

function revalidateAll(...paths: string[]): void {
  for (const path of paths) revalidatePath(path);
}

// Form-friendly: every field is an optional string. Trimmed; '' is an
// intentional unset (mapped to null in the DAL).
const whatsappChannelInput = zfd.formData({
  whatsapp_phone_number_id: z.string().trim().max(64).default(''),
  whatsapp_waba_id: z.string().trim().max(64).default(''),
  whatsapp_access_token: z.string().trim().max(512).default(''),
  whatsapp_app_secret: z.string().trim().max(256).default(''),
  whatsapp_verify_token: z.string().trim().max(256).default(''),
});

export const updateWhatsAppChannelAction = actionClient
  .inputSchema(whatsappChannelInput)
  .stateAction(async ({ parsedInput }) => {
    // This form only persists WhatsApp config. The global outreach switch is owned
    // solely by updateOutreachMasterSwitchAction — this action neither reads nor
    // writes `outreach_enabled`, so a WhatsApp save cannot clobber the shared
    // switch to false.
    try {
      await updateWhatsAppChannelConfig(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון הגדרות הערוץ נכשל. נסו שוב.');
    }

    revalidateAll(META_WHATSAPP, INDEX);
    return { notice: 'הגדרות הערוץ נשמרו' };
  });

// The connection tests post an empty form; the empty schema keeps the (prevState, formData) signature.
export const testWhatsAppConnectionAction = actionClient
  .inputSchema(zfd.formData({}))
  .stateAction(async () => {
    let r: Awaited<ReturnType<typeof testWhatsAppConnection>>;
    try {
      r = await testWhatsAppConnection();
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('בדיקת החיבור נכשלה');
    }
    if (!r.ok) return returnUserError(r.message);
    return { notice: r.message };
  });

// Form-friendly: every field optional string; '' is an intentional unset (DAL
// maps to null, except the write-only service-account JSON and the four numeric
// tuning fields, where '' leaves the stored value untouched).
const voximplantChannelInput = zfd.formData({
  voximplant_service_account_json: z.string().trim().max(8192).default(''),
  voximplant_rule_id: z.string().trim().max(64).default(''),
  voximplant_caller_id: z.string().trim().max(32).default(''),
  voximplant_callback_secret: z.string().trim().max(256).default(''),
  voximplant_low_balance_threshold: z.string().trim().max(16).default(''),
  voximplant_min_call_reserve: z.string().trim().max(16).default(''),
  voximplant_max_concurrent_calls: z.string().trim().max(8).default(''),
  voximplant_max_calls_per_campaign_hour: z.string().trim().max(8).default(''),
  // Both nullable text; '' unsets. See the note on VoximplantChannelConfig for
  // what each one drives.
  voximplant_call_me_now_rule_id: z.string().trim().max(64).default(''),
  voximplant_application_id: z.string().trim().max(64).default(''),
});

export const updateVoximplantChannelAction = actionClient
  .inputSchema(voximplantChannelInput)
  .stateAction(async ({ parsedInput }) => {
    // Both rule-id fields on this form go through the same one-rule-one-purpose
    // check. They are validated against each other too: `claims` carries the
    // STORED values, so submitting the same id in both boxes would pass the
    // pairwise test against storage — hence the explicit equality check first.
    const claims = await readRuleIdClaims();
    const baseRule = parsedInput.voximplant_rule_id.trim();
    const callMeNowRule = parsedInput.voximplant_call_me_now_rule_id.trim();
    if (baseRule !== '' && baseRule === callMeNowRule) {
      return returnValidationErrors(voximplantChannelInput, {
        voximplant_call_me_now_rule_id: {
          _errors: [
            'אותו Rule ID הוזן גם בשיחות RSVP וגם ב"חייג אליי עכשיו". כלל אחד יכול לשרת ייעוד אחד בלבד.',
          ],
        },
      });
    }
    const baseRuleError = ruleIdAssignmentError(baseRule, 'voximplant_rule_id', claims);
    if (baseRuleError) {
      return returnValidationErrors(voximplantChannelInput, {
        voximplant_rule_id: { _errors: [baseRuleError] },
      });
    }
    const callMeNowRuleError = ruleIdAssignmentError(
      callMeNowRule,
      'voximplant_call_me_now_rule_id',
      claims,
    );
    if (callMeNowRuleError) {
      return returnValidationErrors(voximplantChannelInput, {
        voximplant_call_me_now_rule_id: { _errors: [callMeNowRuleError] },
      });
    }

    // No enable-guard here: this form only persists Voximplant config. The global
    // switch is owned by updateOutreachMasterSwitchAction, whose own guard ("≥1
    // channel configured") reads THIS saved config's `configured` flag.
    try {
      await updateVoximplantChannelConfig(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון הגדרות הערוץ נכשל. נסו שוב.');
    }

    revalidateAll(VOXIMPLANT, INDEX);
    return { notice: 'הגדרות הערוץ נשמרו' };
  });

export const testVoximplantConnectionAction = actionClient
  .inputSchema(zfd.formData({}))
  .stateAction(async () => {
    let r: Awaited<ReturnType<typeof testVoximplantConnection>>;
    try {
      r = await testVoximplantConnection();
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('בדיקת החיבור נכשלה');
    }
    if (!r.ok) return returnUserError(r.message);
    return { notice: r.message };
  });

// Fetches the account's routing rules so the admin rule-id fields can offer a
// LIST instead of a free-text number. Not a form action: it takes no input
// and writes nothing — the client calls it from a button and renders the result
// itself, which is why it returns the rules rather than a notice.
//
// Authorization lives in the DAL (requirePlatformPermission('manage_voice')),
// same as testVoximplantConnection; this wrapper only converts a thrown error
// into a message the panel can show.
export const loadVoximplantRulesAction = actionClient.action(async () => {
  let r: VoximplantRulesResult;
  try {
    r = await listVoximplantRules();
  } catch (err) {
    unstable_rethrow(err);
    return returnUserError('טעינת הכללים נכשלה');
  }
  if (!r.ok) return returnUserError(r.message);
  return { rules: r.rules };
});

// The SOLE writer of the shared `outreach_enabled` master switch. Fail-closed
// server-side (never trust the client): enabling requires ≥1 configured channel.
export const updateOutreachMasterSwitchAction = actionClient
  .inputSchema(zfd.formData({ outreach_enabled: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { outreach_enabled: enabled } }) => {
    if (enabled) {
      const state = await getOutreachMasterState(); // manage_settings gate inside; re-checks readiness server-side
      if (!state.anyChannelReady) {
        return returnUserError(
          'לא ניתן להפעיל פנייה ללא ערוץ מוגדר אחד לפחות. הגדירו ושמרו ערוץ תחילה.',
        );
      }
    }
    try {
      await setOutreachEnabled(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון מתג הפנייה נכשל. נסו שוב.');
    }
    revalidateAll(META_WHATSAPP, VOXIMPLANT, INDEX);
    return { notice: enabled ? 'פנייה לאורחים מופעלת' : 'פנייה לאורחים כבויה' };
  });

// Admin toggle for the LIVE-DIAL gate (app_settings.voximplant_live_calls).
// Enabling PERMITS real, paid outbound calls. Fail-closed: refuses to enable
// without a complete dial config (SA + rule + caller + callback).
// Emits a SECURITY Slack audit on every flip. The env VOXIMPLANT_LIVE_CALLS
// ='false' still hard-overrides regardless of this toggle. manage_voice is
// enforced in getVoximplantChannelConfig + updateVoximplantLiveCalls.
export const updateVoximplantLiveCallsAction = actionClient
  .inputSchema(zfd.formData({ voximplant_live_calls: zfd.checkbox() }))
  .stateAction(async ({ parsedInput: { voximplant_live_calls: enabled } }) => {
    if (enabled) {
      const cfg = await getVoximplantChannelConfig(); // manage_voice gate inside
      if (!cfg.fullyConfigured) {
        return returnUserError(
          'לא ניתן להפעיל שיחות חיות ללא קונפיג מלא — חשבון שירות, Rule ID, מספר יוצא ו-Callback Secret.',
        );
      }
    }
    try {
      await updateVoximplantLiveCalls(enabled);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון מתג השיחות החיות נכשל. נסו שוב.');
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
        ? 'שיחות חיות מופעלות — שיחות בתשלום ייצאו לאורחים'
        : 'שיחות חיות כובו',
    };
  });

// Every rule id currently claimed anywhere, so a save can refuse to hand one
// rule to a second persona. The read gates on manage_voice internally, the same
// permission every caller here already holds.
async function readRuleIdClaims(): Promise<RuleIdClaim[]> {
  const cfg = await getVoximplantChannelConfig();
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
  ];
}

// Per-persona kill switches — meeting-confirm and sales-closing each get their
// OWN toggle+rule_id, deliberately separate from
// voximplant_live_calls/voximplant_rule_id (the RSVPAgent bridge rule,
// 1520915/`OutCallAgent`, must never carry another persona's calls). Rule
// 1494311 is `OutCall` — the DTMF `RSVP` scenario — and per CLAUDE.md no
// agent persona may point at it at all. Fail-closed like
// updateVoximplantLiveCallsAction: refuses to enable without this persona's
// OWN rule_id AND the shared base config (service account + caller id). The
// rule_id checked is the one submitted in this same request, so "type a rule
// id and enable in one submit" and "enable using an already-saved rule id" both
// work (the form pre-fills the stored value).
const personaRuleId = z.string().trim().max(64).default('');

async function updatePersonaChannel(
  { ruleId, enabled }: { ruleId: string; enabled: boolean },
  ruleIdField: string,
  // Reports a refused rule id on this persona's own rule-id field.
  rejectRuleId: (message: string) => never,
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
): Promise<{ notice: string }> {
  // One rule, one purpose — checked whether the persona is being switched on or
  // off, because the rule id is saved either way.
  const claimError = ruleIdAssignmentError(ruleId, ruleIdField, await readRuleIdClaims());
  if (claimError) return rejectRuleId(claimError);

  // ruleId is ALWAYS what was submitted (the field is defaultValue-pre-filled
  // in the UI, not blank-means-keep) — so the submitted value IS the
  // effective one, no separate stored-value fallback needed here.
  if (enabled) {
    const cfg = await getVoximplantChannelConfig(); // manage_voice gate inside
    const baseConfigured = cfg.serviceAccountConfigured && !!cfg.voximplant_caller_id;
    if (!baseConfigured || !ruleId) {
      return returnUserError(errors.enableWithoutRule);
    }
  }

  try {
    await update({ ruleId, enabled });
  } catch (err) {
    unstable_rethrow(err);
    return returnUserError(errors.updateFailed);
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

const meetingConfirmChannelInput = zfd.formData({
  voximplant_meeting_confirm_rule_id: personaRuleId,
  voximplant_meeting_confirm_enabled: zfd.checkbox(),
});

export const updateMeetingConfirmChannelAction = actionClient
  .inputSchema(meetingConfirmChannelInput)
  .stateAction(async ({ parsedInput }) =>
    updatePersonaChannel(
      {
        ruleId: parsedInput.voximplant_meeting_confirm_rule_id,
        enabled: parsedInput.voximplant_meeting_confirm_enabled,
      },
      'voximplant_meeting_confirm_rule_id',
      (message) =>
        returnValidationErrors(meetingConfirmChannelInput, {
          voximplant_meeting_confirm_rule_id: { _errors: [message] },
        }),
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
    ),
  );

const salesCallChannelInput = zfd.formData({
  voximplant_sales_call_rule_id: personaRuleId,
  voximplant_sales_calls_enabled: zfd.checkbox(),
});

export const updateSalesCallChannelAction = actionClient
  .inputSchema(salesCallChannelInput)
  .stateAction(async ({ parsedInput }) =>
    updatePersonaChannel(
      {
        ruleId: parsedInput.voximplant_sales_call_rule_id,
        enabled: parsedInput.voximplant_sales_calls_enabled,
      },
      'voximplant_sales_call_rule_id',
      (message) =>
        returnValidationErrors(salesCallChannelInput, {
          voximplant_sales_call_rule_id: { _errors: [message] },
        }),
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
    ),
  );

// Edit ONE existing channel's display metadata (label / built-flag / show-hide /
// order) in the channel catalog (public.channels). `key` is immutable and there
// is no create/delete — adding a channel is a schema+code concern, not a metadata
// edit (see the DAL note + plans/channels-data-driven-plan.md). manage_settings +
// admin RLS enforced in the DAL.
const channelCatalogInput = zfd.formData({
  key: z.string().trim().min(1).max(64),
  display_name: z
    .string({ error: 'שם תצוגה חובה' })
    .trim()
    .min(1, { error: 'שם תצוגה חובה' })
    .max(64),
  // Unchecked checkboxes are absent from FormData → false.
  is_built: zfd.checkbox(),
  active: zfd.checkbox(),
  // An empty or absent sort order is 0.
  sort_order: z.coerce.number().int().min(0).max(9999).prefault('0'),
});

export const updateChannelCatalogAction = actionClient
  .inputSchema(channelCatalogInput)
  .stateAction(async ({ parsedInput }) => {
    try {
      await updateChannelMetadata(parsedInput);
    } catch (err) {
      unstable_rethrow(err);
      return returnUserError('עדכון הערוץ נכשל. נסו שוב.');
    }
    // The catalog editor renders in a section of the integrations index, so the
    // index is the one surface that has to be re-rendered.
    revalidatePath(INDEX);
    return { notice: `הערוץ "${parsedInput.display_name}" נשמר` };
  });

// ─── SEND POLICY ─────────────────────────────────────────────────────────────
// updateSendPolicy (manage_settings). The send-timing window every campaign is
// scheduled against.
//
// Thin on purpose. Form → policy is a PURE function (sendPolicyFromFormData) so
// the ceiling rejections can be tested without a Server Action runtime, and the
// ceilings themselves live in parseSendPolicy, which both that function and the
// DAL call. This action decides nothing about what a legal window is.
//
// The input schema hands sendPolicyFromFormData the FormData as posted — not through zfd.formData, which would expand
// the dotted field names (`weekday.0.start`) into nested objects — and turns each refusal into an issue on that same
// name, so the form reads it at validationErrors.fieldErrors['weekday.0.start'] (whole-policy refusals at `_root`).
const sendPolicyInput = z.instanceof(FormData).transform((formData, ctx) => {
  const parsed = sendPolicyFromFormData(formData);
  if (parsed.ok) return parsed.policy;
  for (const [field, messages] of Object.entries(parsed.fieldErrors)) {
    for (const message of messages) {
      ctx.addIssue({ code: 'custom', message, input: formData, path: [field] });
    }
  }
  return z.NEVER;
});

export const updateSendPolicyAction = actionClient
  .inputSchema(sendPolicyInput)
  .stateAction(async ({ parsedInput: policy }) => {
    try {
      await updateSendPolicy(policy);
    } catch (err) {
      unstable_rethrow(err);
      // The DAL re-validates, so a throw here is a write failure or a gate
      // rejection — not a rejected window, which never reaches this line.
      return returnUserError('שמירת מדיניות השליחה נכשלה. נסו שוב.');
    }

    revalidateAll(META_WHATSAPP);
    return { notice: 'מדיניות השליחה נשמרה' };
  });
