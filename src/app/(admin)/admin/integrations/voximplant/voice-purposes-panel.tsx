'use client';

import { useActionState } from 'react';

import { FormError, FormNotice, SubmitButton } from '@/components/forms';
import {
  createVoicePurposeAction,
  updateVoicePurposeAction,
} from '@/app/(admin)/admin/integrations/actions';
import type { VoicePurposeAdminRow } from '@/lib/data/admin/voice-purposes';
import { VoximplantRuleField } from './voximplant-rule-field';

// The registry that turns "a fourth voice agent" from a code project into a row.
//
// ⚠️ SIBLING FORMS, NEVER NESTED — carried over from the personas panel, where a
// <form> inside another <form> produced "React form was unexpectedly submitted"
// on this exact page. Each row owns its own <form> and its own useActionState.
//
// ⚠️ WHAT THIS PANEL DOES NOT DO. It does not create an ElevenLabs agent or a
// Voximplant scenario — those are built on those platforms, and that boundary is
// what keeps every dial behind the live-calls switch, the dialling window, the
// Shabbat block, DNC and consent. This records WHICH rule to start.

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

function PurposeRow({ purpose }: { purpose: VoicePurposeAdminRow }) {
  const [state, action] = useActionState(updateVoicePurposeAction, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="key" value={purpose.key} />

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-2 py-0.5 text-xs">{purpose.key}</code>
        {purpose.isBuiltin && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            מובנה — מחייג דרך המנוע הייעודי שלו
          </span>
        )}
      </div>

      <label className="block">
        <span className={labelClass}>שם לתצוגה</span>
        <input name="displayName" defaultValue={purpose.displayName} className={inputClass} required />
      </label>

      <label className="block">
        <span className={labelClass}>תיאור</span>
        <input name="description" defaultValue={purpose.description ?? ''} className={inputClass} />
      </label>

      {/* A built-in purpose reads its rule id from app_settings and dials through
          its own dispatcher. Editing it here would change a label while the
          owner believed they had changed a rule — so the fields are not shown. */}
      {!purpose.isBuiltin && (
        <>
          <VoximplantRuleField
            name="ruleId"
            label="Rule ID של תרחיש Voximplant"
            defaultValue={purpose.ruleId ?? ''}
            help="הכלל שהייעוד הזה מפעיל. בחרו מרשימת הכללים בחשבון — כך רואים גם איזה תרחיש כל כלל באמת מריץ."
          />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={purpose.enabled} />
              מופעל — מתיר שיחות אמיתיות בתשלום
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={purpose.active} />
              מוצג ברשימות
            </label>
          </div>
        </>
      )}

      {state?.error && <FormError message={state.error} />}
      {state?.notice && <FormNotice message={state.notice} />}
      <SubmitButton className="w-auto">שמירה</SubmitButton>
    </form>
  );
}

export function VoicePurposesPanel({ purposes }: { purposes: readonly VoicePurposeAdminRow[] }) {
  const [state, action] = useActionState(createVoicePurposeAction, null);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">ייעודי שיחה</h2>
        <p className="text-sm text-muted-foreground">
          כל ייעוד הוא סוכן קולי אחד. בנו את הסוכן ב-ElevenLabs ואת התרחיש ב-Voximplant, ואז הוסיפו
          כאן שורה עם ה-Rule ID — התהליכים יוכלו לבחור בו בלי שינוי קוד.
        </p>
      </div>

      <div className="space-y-3">
        {purposes.map((p) => (
          <PurposeRow key={p.key} purpose={p} />
        ))}
      </div>

      <form action={action} className="space-y-3 rounded-lg border border-dashed border-border p-4">
        <h3 className="font-medium">ייעוד חדש</h3>

        <label className="block">
          <span className={labelClass}>מזהה</span>
          <input name="key" className={inputClass} placeholder="feedback" required />
          <span className="mt-1 block text-xs text-muted-foreground">
            אנגלית קטנה, ספרות וקו תחתון. לא ניתן לשינוי אחר כך — תהליך שמור זוכר אותו.
          </span>
        </label>

        <label className="block">
          <span className={labelClass}>שם לתצוגה</span>
          <input name="displayName" className={inputClass} placeholder="שיחת משוב אחרי האירוע" required />
        </label>

        <label className="block">
          <span className={labelClass}>תיאור</span>
          <input name="description" className={inputClass} />
        </label>

        <VoximplantRuleField
          name="ruleId"
          label="Rule ID של תרחיש Voximplant"
          defaultValue=""
          help="הכלל שהייעוד הזה יפעיל. בחרו מרשימת הכללים בחשבון — כך רואים גם איזה תרחיש כל כלל באמת מריץ."
        />

        {state?.error && <FormError message={state.error} />}
        {state?.notice && <FormNotice message={state.notice} />}

        {/* Created switched OFF, always. A row carries a rule id, and the moment
            it is enabled a workflow step can telephone guests with it — a typo
            would become a real call. Somebody looks at the row once more first. */}
        <p className="text-xs text-muted-foreground">הייעוד נוצר כבוי. הפעילו אותו אחרי בדיקת ה-Rule ID.</p>
        <SubmitButton className="w-auto">יצירה</SubmitButton>
      </form>
    </section>
  );
}
