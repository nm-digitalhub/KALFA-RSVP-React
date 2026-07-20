'use client';

import { useActionState, useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';

import {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
} from '@/components/ui/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from '@/components/ui/accordion';
import { HelpTip } from '@/app/(admin)/admin/agreement/help-tip';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import {
  updateWhatsAppChannelAction,
  testWhatsAppConnectionAction,
  updateVoximplantChannelAction,
  testVoximplantConnectionAction,
  updateOutreachMasterSwitchAction,
  updateVoximplantLiveCallsAction,
} from './actions';

type WhatsAppConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  configured: boolean;
};

type VoximplantConfig = {
  serviceAccountConfigured: boolean;
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string;
  voximplant_low_balance_threshold: string;
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
  configured: boolean;
  fullyConfigured: boolean; // full dial config — gates the live-calls toggle
  liveCalls: boolean; // raw admin toggle value (app_settings.voximplant_live_calls)
  liveEnabled: boolean; // effective gate (toggle AND env not force-off)
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  help,
  errors,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  help?: string;
  errors?: string[];
}) {
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError errors={errors} />
    </div>
  );
}

function SecretField({
  name,
  label,
  defaultValue,
  hint,
  help,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  help?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>
      <div className="relative">
        <input
          id={name}
          name={name}
          type={show ? 'text' : 'password'}
          defaultValue={defaultValue}
          autoComplete="off"
          className={`${inputClass} pe-10`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'הסתר' : 'הצג'}
          className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground transition hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {value || '—'}
        </code>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label="העתק"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-2 text-xs transition hover:bg-accent/40 disabled:opacity-50"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({
  configured,
  enabled,
  liveGateOff,
}: {
  configured: boolean;
  enabled: boolean;
  liveGateOff?: boolean;
}) {
  const [text, cls] =
    enabled && liveGateOff
      ? [
          'מוגדר · דלוק · שיחות מושבתות',
          'bg-amber-500/10 text-amber-600 border-amber-500/30',
        ]
      : enabled
        ? ['פעיל', 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30']
        : configured
          ? ['מוגדר · כבוי', 'bg-amber-500/10 text-amber-600 border-amber-500/30']
          : ['לא מוגדר', 'bg-muted text-muted-foreground border-border'];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${cls}`}
    >
      {text}
    </span>
  );
}

function OutreachMasterSwitch({
  enabled,
  anyChannelReady,
}: {
  enabled: boolean;
  anyChannelReady: boolean;
}) {
  const [state, action] = useActionState(
    updateOutreachMasterSwitchAction,
    null,
  );
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold">מתג פנייה ראשי (כל הערוצים)</p>
        <p className="text-xs text-muted-foreground">
          מפעיל שליחות/שיחות חיות בכל ערוץ מוגדר. שיחות Voximplant דורשות בנוסף
          את מתג השרת VOXIMPLANT_LIVE_CALLS.
        </p>
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="outreach_enabled"
            defaultChecked={enabled}
            disabled={!enabled && !anyChannelReady}
            className="size-4 accent-primary"
          />
          מופעל
        </label>
        <SubmitButton className="w-auto">עדכון</SubmitButton>
      </div>
    </form>
  );
}

export function ChannelsClient({
  whatsapp,
  callbackUrl,
  voximplant,
  voxCtxBase,
  voxCbBase,
  outreachEnabled,
  anyChannelReady,
}: {
  whatsapp: WhatsAppConfig;
  callbackUrl: string;
  voximplant: VoximplantConfig;
  voxCtxBase: string;
  voxCbBase: string;
  outreachEnabled: boolean;
  anyChannelReady: boolean;
}) {
  const [state, action] = useActionState(updateWhatsAppChannelAction, null);
  const [testState, testAction] = useActionState(
    testWhatsAppConnectionAction,
    null,
  );
  const [voxState, voxAction] = useActionState(
    updateVoximplantChannelAction,
    null,
  );
  const [voxTestState, voxTestAction] = useActionState(
    testVoximplantConnectionAction,
    null,
  );
  const [voxLiveState, voxLiveAction] = useActionState(
    updateVoximplantLiveCallsAction,
    null,
  );
  const e = state?.fieldErrors;
  const ve = voxState?.fieldErrors;

  return (
    <div className="space-y-6">
      {/* single global master switch — ABOVE the tabs (§1.0) */}
      <OutreachMasterSwitch
        enabled={outreachEnabled}
        anyChannelReady={anyChannelReady}
      />

      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTab value="whatsapp">
            WhatsApp {whatsapp.configured ? '✓' : '⚠'}
          </TabsTab>
          <TabsTab value="voximplant">
            שיחות AI {voximplant.configured ? '✓' : '⚠'}
          </TabsTab>
        </TabsList>

      <TabsPanel value="whatsapp">
        <form action={action} className="space-y-4">
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />

          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <StatusBadge
              configured={whatsapp.configured}
              enabled={outreachEnabled && whatsapp.configured}
            />
            <span className="text-sm text-muted-foreground">
              מצב ערוץ WhatsApp. הפעלה/כיבוי דרך מתג הפנייה הראשי שמעל.
            </span>
          </div>

          <Accordion defaultValue={['creds']}>
            <AccordionItem value="creds">
              <AccordionTrigger>פרטי התחברות</AccordionTrigger>
              <AccordionPanel>
                <div className="space-y-4 text-foreground">
                  <Field
                    name="whatsapp_phone_number_id"
                    label="Phone Number ID"
                    defaultValue={whatsapp.whatsapp_phone_number_id}
                    placeholder="מזהה מספר העסק ב-WhatsApp"
                    errors={e?.whatsapp_phone_number_id}
                  />
                  <Field
                    name="whatsapp_waba_id"
                    label="WhatsApp Business Account ID"
                    defaultValue={whatsapp.whatsapp_waba_id}
                    placeholder="מזהה חשבון ה-WABA"
                    help="מזהה חשבון ה-WhatsApp Business (WABA) — היעד לניהול תבניות ההודעה ושליחתן לאישור Meta. נמצא ב-WhatsApp Manager › Account tools, או ב-Meta App › WhatsApp › API Setup."
                    errors={e?.whatsapp_waba_id}
                  />
                  <SecretField
                    name="whatsapp_access_token"
                    label="Access Token"
                    defaultValue={whatsapp.whatsapp_access_token}
                    help="חובה טוקן System-User קבוע (לא הטוקן הזמני ל-24ש'), עם ההרשאות whatsapp_business_messaging + whatsapp_business_management + business_management."
                    hint="נשמר מוצפן בשרת; לעולם לא נחשף בלוגים."
                  />
                  <SecretField
                    name="whatsapp_app_secret"
                    label="App Secret"
                    defaultValue={whatsapp.whatsapp_app_secret}
                    help="ה-App Secret של אפליקציית Meta — משמש לאימות חתימת ה-Webhook (X-Hub-Signature-256)."
                  />
                  <Field
                    name="whatsapp_verify_token"
                    label="Verify Token"
                    defaultValue={whatsapp.whatsapp_verify_token}
                    help="מחרוזת שאתם ממציאים — מדביקים אותה גם כאן וגם בהגדרת ה-Webhook ב-Meta (אימות GET)."
                    placeholder="מחרוזת אקראית שתבחרו"
                  />
                </div>
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="webhook">
              <AccordionTrigger>חיווט Webhook (להדבקה ב-Meta)</AccordionTrigger>
              <AccordionPanel>
                <div className="space-y-3">
                  <CopyRow label="Callback URL" value={callbackUrl} />
                  <CopyRow
                    label="Verify Token"
                    value={whatsapp.whatsapp_verify_token}
                  />
                  <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                    <li>Meta App → WhatsApp → Configuration → Webhook.</li>
                    <li>הדביקו את ה-Callback URL ואת ה-Verify Token.</li>
                    <li>הירשמו לשדה messages.</li>
                  </ol>
                </div>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>

          <SubmitButton>שמירה</SubmitButton>
        </form>

        <form action={testAction} className="mt-4 space-y-2">
          <FormError message={testState?.error} />
          <FormNotice message={testState?.notice} />
          <button
            type="submit"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
          >
            בדיקת חיבור
          </button>
        </form>
      </TabsPanel>

      <TabsPanel value="voximplant">
        {/* Status badge + LIVE-CALLS toggle — SIBLINGS above the config form.
            A <form> must NEVER nest inside another <form> (nesting caused a
            "React form was unexpectedly submitted" error). */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
          <StatusBadge
            configured={voximplant.configured}
            enabled={outreachEnabled && voximplant.configured}
            liveGateOff={!voximplant.liveEnabled}
          />
          <span className="text-sm text-muted-foreground">
            {voximplant.liveEnabled
              ? 'שיחות חיות מופעלות — שיחות בתשלום יוצאות בפועל.'
              : 'שיחות חיות כבויות (מצב dark). הפעילו במתג שיחות חיות.'}
          </span>
        </div>

        {/* LIVE-CALLS toggle — permits REAL paid dialing. Admin-only page.
            Fail-closed: cannot enable without the full config. The env
            VOXIMPLANT_LIVE_CALLS='false' still hard-overrides (ops kill switch). */}
        <form
          action={voxLiveAction}
          className="mt-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
        >
          <FormError message={voxLiveState?.error} />
          <FormNotice message={voxLiveState?.notice} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">שיחות חיות (Live calls)</p>
              <p className="text-xs text-muted-foreground">
                הפעלה = שיחות טלפון אמיתיות בתשלום, לאנשי קשר שנתנו הסכמה בלבד.
                {voximplant.fullyConfigured
                  ? ''
                  : ' יש להשלים את כל פרטי החשבון והחיוג לפני הפעלה.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="voximplant_live_calls"
                  defaultChecked={voximplant.liveCalls}
                  disabled={!voximplant.fullyConfigured && !voximplant.liveCalls}
                  className="size-4 accent-primary"
                />
                מופעל
              </label>
              <SubmitButton className="w-auto">עדכון</SubmitButton>
            </div>
          </div>
        </form>

        <form action={voxAction} className="mt-4 space-y-4">
          <FormError message={voxState?.error} />
          <FormNotice message={voxState?.notice} />

          <Accordion defaultValue={['vox-creds']}>
            <AccordionItem value="vox-creds">
              <AccordionTrigger>פרטי חשבון וחיוג</AccordionTrigger>
              <AccordionPanel>
                <div className="space-y-4 text-foreground">
                  <div>
                    <label
                      htmlFor="voximplant_service_account_json"
                      className={labelClass}
                    >
                      Service Account JSON
                      <HelpTip text="קובץ ה-JSON של חשבון השירות (account_id / key_id / private_key) מ-Voximplant Control Panel › Service accounts. נשמר מוצפן בשרת ולעולם לא נשלף חזרה לדפדפן." />
                    </label>
                    <textarea
                      id="voximplant_service_account_json"
                      name="voximplant_service_account_json"
                      rows={4}
                      autoComplete="off"
                      placeholder={
                        '{"account_id":…,"key_id":"…","private_key":"…"}'
                      }
                      className={`${inputClass} font-mono`}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {voximplant.serviceAccountConfigured
                        ? '✓ חשבון שירות שמור. השאירו ריק כדי לשמור על הקיים; הדביקו JSON חדש כדי להחליף.'
                        : 'לא הוגדר עדיין — הדביקו את ה-JSON.'}
                    </p>
                  </div>
                  <Field
                    name="voximplant_rule_id"
                    label="Rule ID"
                    defaultValue={voximplant.voximplant_rule_id}
                    placeholder="1494311"
                    errors={ve?.voximplant_rule_id}
                    help="מזהה ה-OutCall rule של תרחיש ה-RSVP ב-Voximplant (StartScenarios)."
                  />
                  <Field
                    name="voximplant_caller_id"
                    label="מספר יוצא (Caller ID)"
                    defaultValue={voximplant.voximplant_caller_id}
                    placeholder="+972…"
                    errors={ve?.voximplant_caller_id}
                    help="מספר Voximplant שנרכש/אומת — משמש כ-from בשיחה היוצאת."
                  />
                  <SecretField
                    name="voximplant_callback_secret"
                    label="Callback Secret"
                    defaultValue={voximplant.voximplant_callback_secret}
                    help="סוד ה-?k= שחותם על כתובות ה-ctx/cb. סובב אותו כדי לפסול טוקנים ישנים."
                  />
                </div>
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="vox-tuning">
              <AccordionTrigger>מגבלות ותקציב</AccordionTrigger>
              <AccordionPanel>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    name="voximplant_low_balance_threshold"
                    label="סף יתרה נמוכה ($)"
                    defaultValue={voximplant.voximplant_low_balance_threshold}
                    placeholder="5"
                    errors={ve?.voximplant_low_balance_threshold}
                  />
                  <Field
                    name="voximplant_min_call_reserve"
                    label="רזרבה מינ׳ לחיוג ($)"
                    defaultValue={voximplant.voximplant_min_call_reserve}
                    placeholder="0.1"
                    errors={ve?.voximplant_min_call_reserve}
                  />
                  <Field
                    name="voximplant_max_concurrent_calls"
                    label="מקס׳ שיחות במקביל"
                    defaultValue={voximplant.voximplant_max_concurrent_calls}
                    placeholder="5"
                    errors={ve?.voximplant_max_concurrent_calls}
                  />
                  <Field
                    name="voximplant_max_calls_per_campaign_hour"
                    label="מקס׳ שיחות לקמפיין/שעה"
                    defaultValue={
                      voximplant.voximplant_max_calls_per_campaign_hour
                    }
                    placeholder="200"
                    errors={ve?.voximplant_max_calls_per_campaign_hour}
                  />
                </div>
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="vox-urls">
              <AccordionTrigger>כתובות התרחיש (לעיון)</AccordionTrigger>
              <AccordionPanel>
                <div className="space-y-3">
                  <CopyRow label="Context base (ctx)" value={voxCtxBase} />
                  <CopyRow label="Callback base (cb)" value={voxCbBase} />
                  <p className="text-xs text-muted-foreground">
                    הכתובות המלאות נבנות בזמן החיוג עם טוקן חתום פר-שיחה; אלו
                    בסיסי הייחוס בלבד.
                  </p>
                </div>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>

          <SubmitButton>שמירה</SubmitButton>
        </form>

        <form action={voxTestAction} className="mt-4 space-y-2">
          <FormError message={voxTestState?.error} />
          <FormNotice message={voxTestState?.notice} />
          <button
            type="submit"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
          >
            בדיקת חיבור (יתרה)
          </button>
        </form>
      </TabsPanel>
      </Tabs>
    </div>
  );
}
