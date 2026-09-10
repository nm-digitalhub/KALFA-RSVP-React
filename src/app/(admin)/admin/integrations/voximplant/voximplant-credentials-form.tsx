'use client';

import { useActionState } from 'react';

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from '@/components/ui/accordion';
import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { HelpTip } from '@/components/help-tip';
import { updateVoximplantChannelAction } from '@/app/(admin)/admin/channels/actions';

import { CopyRow, Field, SecretField } from '../_components/form-fields';

// Account, dial config, budget limits and the scenario base URLs — lifted out of
// channels-client.tsx so the provider page and the old channels tab render one
// definition while both exist. The old page is deleted in Task 0.6, separately.
//
// The three accordion items stay in ONE group, as they are today. The plan (§Task 0.4
// Step 1) split "כתובות התרחיש" into its own file; splitting it would put a save button
// between two halves of one accordion on both surfaces, for no gain — the URLs carry no
// input and being inside the form is harmless.
//
// ⚠️ THE SERVICE-ACCOUNT JSON IS NEVER ROUND-TRIPPED. It is a multi-KB RSA private key;
// the DAL returns only `serviceAccountConfigured`, and the textarea below is always
// empty — blank means "keep what is stored". The callback secret IS returned, masked
// with a reveal toggle (owner ruling 2026-08-24). Those two are deliberately different,
// and the page test asserts both.
//
// The action is imported from its ORIGINAL location on purpose: moving the actions is
// Task 0.3 Step 1's own job, and touching them here would mean two passes over the same
// file. The wiring is identical either way.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

export type VoximplantCredentials = {
  serviceAccountConfigured: boolean; // presence only — the JSON key is never returned
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string;
  voximplant_low_balance_threshold: string;
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
};

export function VoximplantCredentialsForm({
  voximplant,
  voxCtxBase,
  voxCbBase,
}: {
  voximplant: VoximplantCredentials;
  voxCtxBase: string;
  voxCbBase: string;
}) {
  const [state, action] = useActionState(updateVoximplantChannelAction, null);
  const ve = state?.fieldErrors;

  return (
    <form action={action} className="mt-4 space-y-4">
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <Accordion defaultValue={['vox-creds']}>
        <AccordionItem value="vox-creds">
          <AccordionTrigger>פרטי חשבון וחיוג</AccordionTrigger>
          <AccordionPanel>
            <div className="space-y-4 text-foreground">
              <div>
                <label htmlFor="voximplant_service_account_json" className={labelClass}>
                  Service Account JSON
                  <HelpTip text="קובץ ה-JSON של חשבון השירות (account_id / key_id / private_key) מ-Voximplant Control Panel › Service accounts. נשמר מוצפן בשרת ולעולם לא נשלף חזרה לדפדפן." />
                </label>
                <textarea
                  id="voximplant_service_account_json"
                  name="voximplant_service_account_json"
                  rows={4}
                  autoComplete="off"
                  placeholder={'{"account_id":…,"key_id":"…","private_key":"…"}'}
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
                defaultValue={voximplant.voximplant_max_calls_per_campaign_hour}
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
  );
}
