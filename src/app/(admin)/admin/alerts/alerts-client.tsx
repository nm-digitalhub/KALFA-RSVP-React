'use client';

import { useActionState, useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
} from '@/components/forms';
import type { SlackAlertsView } from '@/lib/data/admin/alerts';
import type { AlertCategoryKey } from '@/lib/data/admin/alerts';
import {
  clearSlackConnectionAction,
  saveSlackConnectionAction,
  saveSlackMentionAction,
  sendTestAlertAction,
  setAlertToggleAction,
} from './actions';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';

function ConnectionStatus({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
      מחובר ✓
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
      לא מוגדר
    </span>
  );
}

// One switch bound to a server action (master or a category). Optimistic local
// state; reverts if the action reports an error.
function ToggleRow({
  label,
  hint,
  defaultChecked,
  category,
}: {
  label: string;
  hint: string;
  defaultChecked: boolean;
  category?: AlertCategoryKey;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onChange = (next: boolean): void => {
    setChecked(next); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await setAlertToggleAction({ enabled: next, category });
      if (result && 'error' in result && result.error) {
        setChecked(!next); // revert
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={pending}
        aria-label={label}
      />
    </div>
  );
}

export function AlertsClient({ view }: { view: SlackAlertsView }) {
  const [saveState, saveAction] = useActionState(saveSlackConnectionAction, null);
  const [testState, testAction] = useActionState(sendTestAlertAction, null);
  const [clearState, clearAction] = useActionState(
    clearSlackConnectionAction,
    null,
  );
  const [mentionState, mentionAction] = useActionState(saveSlackMentionAction, null);
  const [showToken, setShowToken] = useState(false);
  const fieldErrors = saveState?.fieldErrors;
  const mentionFieldErrors = mentionState?.fieldErrors;

  return (
    <div className="space-y-6">
      {/* Connection */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">חיבור ל-Slack</h2>
            <p className="text-sm text-muted-foreground">
              טוקן bot (xoxb-) ומזהה הערוץ שאליו יישלחו ההתראות. הטוקן נשמר בשרת
              בלבד ולעולם לא נחשף בחזרה לדפדפן.
            </p>
          </div>
          <ConnectionStatus connected={view.connected} />
        </div>

        <form action={saveAction} className="space-y-4">
          <FormError message={saveState?.error} />
          <FormNotice message={saveState?.notice} />

          <div className="space-y-1">
            <label htmlFor="slack_bot_token" className="text-sm font-medium">
              Bot Token
            </label>
            <div className="relative">
              <input
                id="slack_bot_token"
                name="slack_bot_token"
                type={showToken ? 'text' : 'password'}
                dir="ltr"
                autoComplete="off"
                placeholder={
                  view.hasToken ? '•••••••• (שמור) — השאירו ריק לשמירה' : 'xoxb-...'
                }
                className={`${inputClass} pe-10`}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'הסתר' : 'הצג'}
                className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground transition hover:text-foreground"
              >
                {showToken ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {view.hasToken
                ? 'טוקן קיים שמור. הזינו טוקן חדש רק כדי להחליף אותו.'
                : 'טוקן System-User של אפליקציית Slack עם ההרשאה chat:write.'}
            </p>
            <FieldError errors={fieldErrors?.slack_bot_token} />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="slack_alert_channel_id"
              className="text-sm font-medium"
            >
              מזהה ערוץ (Channel ID)
            </label>
            <input
              id="slack_alert_channel_id"
              name="slack_alert_channel_id"
              type="text"
              dir="ltr"
              autoComplete="off"
              defaultValue={view.channelId}
              placeholder="C0123456789"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              מזהה הערוץ (לא שם הערוץ) — נמצא בתפריט הערוץ ב-Slack ← View channel
              details. ודאו שה-bot הוזמן לערוץ.
            </p>
            <FieldError errors={fieldErrors?.slack_alert_channel_id} />
          </div>

          <SubmitButton className="w-auto">שמירת חיבור</SubmitButton>
        </form>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <form action={testAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent/40"
            >
              שלח התראת בדיקה
            </button>
          </form>
          <form action={clearAction}>
            <button
              type="submit"
              className="rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
            >
              נתק
            </button>
          </form>
        </div>
        <FormError message={testState?.error} />
        <FormNotice message={testState?.notice} />
        <FormError message={clearState?.error} />
        <FormNotice message={clearState?.notice} />
      </section>

      {/* Personal @mention */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">אזכור אישי ב-Slack</h2>
          <p className="text-sm text-muted-foreground">
            תייגו אתכם אישית (@) בראש ההתראה כשחומרתה עוברת סף שתבחרו — כדי לקבל
            התראת דחיפה בנייד גם בערוץ שקט.
          </p>
        </div>

        <form action={mentionAction} className="space-y-4">
          <FormError message={mentionState?.error} />
          <FormNotice message={mentionState?.notice} />

          <div className="space-y-1">
            <label htmlFor="slack_mention_user_id" className="text-sm font-medium">
              מזהה חבר (Member ID)
            </label>
            <input
              id="slack_mention_user_id"
              name="slack_mention_user_id"
              type="text"
              dir="ltr"
              autoComplete="off"
              defaultValue={view.mentionUserId}
              placeholder="U0123456789"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">
              מזהה החבר (לא שם המשתמש) — בפרופיל שלכם ב-Slack ← ⋯ (עוד) ← Copy
              member ID. השאירו ריק כדי לא לתייג אף אחד.
            </p>
            <FieldError errors={mentionFieldErrors?.slack_mention_user_id} />
          </div>

          <div className="space-y-1">
            <label htmlFor="slack_mention_min_level" className="text-sm font-medium">
              סף לתיוג
            </label>
            <select
              id="slack_mention_min_level"
              name="slack_mention_min_level"
              defaultValue={view.mentionMinLevel}
              className={inputClass}
            >
              <option value="off">כבוי</option>
              <option value="error">תייג אותי בשגיאות בלבד</option>
              <option value="warn">אזהרות ומעלה</option>
              <option value="info">הכול</option>
            </select>
            <FieldError errors={mentionFieldErrors?.slack_mention_min_level} />
          </div>

          <SubmitButton className="w-auto">שמירת אזכור</SubmitButton>
        </form>
      </section>

      {/* Toggles */}
      <section className="space-y-2 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">מתגי התראות</h2>
          <p className="text-sm text-muted-foreground">
            מתג ראשי לכל ההתראות, ומתג נפרד לכל קטגוריה. כשמתג כבוי — התראות
            הקטגוריה לא נשלחות.
          </p>
        </div>

        <div className="divide-y divide-border">
          <ToggleRow
            label="הפעלת התראות (ראשי)"
            hint="כשכבוי — לא נשלחת אף התראה, גם אם החיבור מוגדר."
            defaultChecked={view.enabled}
          />
          <ToggleRow
            label="שגיאות מערכת"
            hint="שגיאות שרת לא-מטופלות ותקלות ב-worker / בעבודות הרקע."
            defaultChecked={view.categories.errors}
            category="errors"
          />
          <ToggleRow
            label="תקינות שליחה"
            hint="כשלי ספק בשליחת WhatsApp / SMS / חיוב (SUMIT)."
            defaultChecked={view.categories.sendHealth}
            category="send_health"
          />
          <ToggleRow
            label="קמפיינים וחיוב"
            hint="חתימת הסכם, הפעלה/ביטול קמפיין, וחיוב סופי (בוצע/נדחה)."
            defaultChecked={view.categories.campaignBilling}
            category="campaign_billing"
          />
          <ToggleRow
            label="אבטחה"
            hint="מתן/שלילת הרשאת מנהל, השהיה/שחזור משתמש ואירועי אבטחה."
            defaultChecked={view.categories.security}
            category="security"
          />
        </div>
      </section>
    </div>
  );
}
