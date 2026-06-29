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
} from './actions';

type WhatsAppConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  configured: boolean;
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
}: {
  configured: boolean;
  enabled: boolean;
}) {
  const [text, cls] = enabled
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

export function ChannelsClient({
  whatsapp,
  callbackUrl,
}: {
  whatsapp: WhatsAppConfig;
  callbackUrl: string;
}) {
  const [state, action] = useActionState(updateWhatsAppChannelAction, null);
  const [testState, testAction] = useActionState(
    testWhatsAppConnectionAction,
    null,
  );
  const e = state?.fieldErrors;

  return (
    <Tabs defaultValue="whatsapp">
      <TabsList>
        <TabsTab value="whatsapp">
          WhatsApp {whatsapp.configured ? '✓' : '⚠'}
        </TabsTab>
        <TabsTab value="voximplant" disabled>
          Voximplant (בקרוב)
        </TabsTab>
      </TabsList>

      <TabsPanel value="whatsapp">
        <form action={action} className="space-y-4">
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <StatusBadge
                configured={whatsapp.configured}
                enabled={whatsapp.outreach_enabled}
              />
              <span className="text-sm text-muted-foreground">
                הפעלת הערוץ = שליחות חיות בתשלום לאורחים.
              </span>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="outreach_enabled"
                defaultChecked={whatsapp.outreach_enabled}
                className="size-4 accent-primary"
              />
              מופעל
            </label>
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
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          ערוץ שיחות ה-AI (Voximplant) ייפתח להגדרה עם בניית הערוץ (C2).
        </div>
      </TabsPanel>
    </Tabs>
  );
}
