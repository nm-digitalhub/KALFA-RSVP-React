'use client';

import { useActionState } from 'react';

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from '@/components/ui/accordion';
import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import { updateWhatsAppChannelAction } from '@/app/(admin)/admin/channels/actions';

import { CopyRow, Field, SecretField, StatusBadge } from '../_components/form-fields';

// Credentials + webhook wiring for the WhatsApp channel, lifted out of
// channels-client.tsx so the provider page and the old channels tab render the SAME
// markup from one definition while both exist (the old page is deleted in Task 0.6,
// separately, after a clean deploy — that separation is what makes Phase 0 reversible
// at zero cost).
//
// The action is imported from its ORIGINAL location on purpose. Moving the actions is
// Task 0.3 Step 1's own job and touching them here would mean two moves through the
// same file; the wiring is identical either way.

export type WhatsAppCredentials = {
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  configured: boolean;
};

export function WhatsAppCredentialsForm({
  whatsapp,
  callbackUrl,
  outreachEnabled,
}: {
  whatsapp: WhatsAppCredentials;
  callbackUrl: string;
  outreachEnabled: boolean;
}) {
  const [state, action] = useActionState(updateWhatsAppChannelAction, null);
  const e = state?.fieldErrors;

  return (
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
  );
}
