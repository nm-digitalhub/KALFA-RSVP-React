'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { Pagination } from '@/components/pagination';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import type { CallDncEntry, RegistryConnectionStatus } from '@/lib/data/admin/call-dnc';
import { formatIsraelDateTime } from '@/lib/date';
import type { RegistryResult } from '@/lib/dnc/registry-check';
import { addToCallDncAction, checkNumberAction, setRegistryGateAction } from './actions';

export type DncTab = 'check' | 'local' | 'status';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 block text-sm font-medium';
const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// The fixed wording for each result (openspec/changes/dnc-registry-dial-gate D9). "Not registered" never promises a
// call: consent, hours and the other gates still decide.
const RESULT_TEXT: Record<RegistryResult, string> = {
  registry_clear: 'המספר אינו רשום במאגר. החיוג כפוף לשאר תנאי המערכת.',
  registry_listed: 'המספר רשום במאגר.',
  registry_unchecked: 'לא ניתן להשלים את הבדיקה. לא בוצע חיוג.',
  registry_unavailable: 'לא ניתן להשלים את הבדיקה. לא בוצע חיוג.',
  local_blocked: 'המספר חסום ברשימה המקומית.',
  not_covered: 'המאגר הישראלי אינו מכסה מספר זה.',
};

const SOURCE_TEXT: Record<string, string> = {
  national_registry: 'מאגר "אל תתקשר אליי"',
  local_list: 'הרשימה המקומית',
  none: 'ללא פנייה למאגר',
};

export function DncClient({
  defaultTab,
  entries,
  total,
  page,
  pageSize,
  query,
  status,
}: {
  defaultTab: DncTab;
  entries: CallDncEntry[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  status: RegistryConnectionStatus;
}) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTab value="check">בדיקת מספר</TabsTab>
        <TabsTab value="local">חסימות מקומיות</TabsTab>
        <TabsTab value="status">מצב החיבור</TabsTab>
      </TabsList>

      <TabsPanel value="check" keepMounted>
        <CheckNumberPanel />
      </TabsPanel>
      <TabsPanel value="local" keepMounted>
        <LocalListPanel entries={entries} total={total} page={page} pageSize={pageSize} query={query} />
      </TabsPanel>
      <TabsPanel value="status" keepMounted>
        <ConnectionStatusPanel status={status} />
      </TabsPanel>
    </Tabs>
  );
}

function CheckNumberPanel() {
  const [state, action] = useActionState(checkNumberAction, null);

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-semibold">בדיקת מספר</h2>
        <p className="text-sm text-muted-foreground">
          בודק את המספר ברשימה המקומית ובמאגר &quot;אל תתקשר אליי&quot; של הרשות להגנת הצרכן. הבדיקה אינה מחייגת
          למספר.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grow">
          <label htmlFor="check-phone" className={labelClass}>
            מספר טלפון
          </label>
          <input
            id="check-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="05x-xxxxxxx"
            dir="ltr"
            className={inputClass}
          />
        </div>
        <SubmitButton className="w-auto">בדיקה</SubmitButton>
      </form>

      {state && 'error' in state ? <FormError message={state.error} /> : null}
      {state && 'result' in state ? (
        <div role="status" className="space-y-1 rounded-md border border-border bg-muted/40 p-4">
          <p className="font-medium">{RESULT_TEXT[state.result]}</p>
          <p className="text-sm text-muted-foreground">
            מקור: {SOURCE_TEXT[state.source] ?? state.source} · מועד: {formatIsraelDateTime(state.checkedAt)}
          </p>
          {state.transactionId ? (
            <p className="text-xs text-muted-foreground">
              מזהה בקשה ברשות: <span dir="ltr" className="font-mono">{state.transactionId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LocalListPanel({
  entries,
  total,
  page,
  pageSize,
  query,
}: {
  entries: CallDncEntry[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
}) {
  const [state, action] = useActionState(addToCallDncAction, null);
  const fieldErrors = state?.fieldErrors;

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-semibold">חסימות מקומיות</h2>
        <p className="text-sm text-muted-foreground">
          מי שביקש מאיתנו לא להתקשר אליו. מספר ברשימה לא יקבל אף שיחה מהמערכת: אישורי הגעה, מכירות, אישור
          פגישות, &quot;התקשרו אליי&quot; וחיוג מהקונסולה. הרשימה נפרדת מהמאגר הממשלתי, ותוצאת בדיקה במאגר לא
          מתווספת אליה.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="phone" className={labelClass}>
              מספר טלפון
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="05x-xxxxxxx"
              dir="ltr"
              className={inputClass}
            />
            <FieldError errors={fieldErrors?.phone} />
          </div>
          <div>
            <label htmlFor="reason" className={labelClass}>
              סיבה (רשות)
            </label>
            <input
              id="reason"
              name="reason"
              autoComplete="off"
              placeholder="בקשת הסרה, תלונה וכו׳"
              className={inputClass}
            />
            <FieldError errors={fieldErrors?.reason} />
          </div>
        </div>
        <SubmitButton className="w-auto">הוספה לרשימת החסימה</SubmitButton>
      </form>

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="tab" value="local" />
        <div className="grow">
          <label htmlFor="q" className={labelClass}>
            חיפוש מספר
          </label>
          <input
            id="q"
            name="q"
            type="search"
            inputMode="tel"
            defaultValue={query}
            dir="ltr"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
        >
          חיפוש
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{query ? 'לא נמצאו מספרים תואמים.' : 'אין מספרים חסומים.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">מספר</th>
                <th className="px-3 py-2 text-start font-medium">סיבה</th>
                <th className="px-3 py-2 text-start font-medium">נוסף בתאריך</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.normalized_phone} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 font-mono" dir="ltr">
                    {entry.normalized_phone}
                  </td>
                  <td className="px-3 py-2">
                    {entry.reason || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatIsraelDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath="/admin/dnc"
        page={page}
        pageSize={pageSize}
        total={total}
        queryParams={{ tab: 'local', q: query }}
      />
    </section>
  );
}

const FAILURE_TEXT: Record<string, string> = {
  not_configured: 'פרטי הגישה לא הוגדרו בשרת',
  http_error: 'השירות החזיר שגיאה',
  unreachable: 'לא ניתן להגיע לשירות',
  bad_body: 'תשובה לא צפויה מהשירות',
  bad_answer: 'תשובה במבנה לא צפוי',
  invalid_request: 'בקשה לא תקינה',
};

function ConnectionStatusPanel({ status }: { status: RegistryConnectionStatus }) {
  const [state, action] = useActionState(setRegistryGateAction, null);

  return (
    <section className={sectionClass}>
      <div>
        <h2 className="text-lg font-semibold">מצב החיבור למאגר</h2>
        <p className="text-sm text-muted-foreground">
          החיבור לשירות &quot;אל תתקשר אליי&quot;. פרטי הגישה שמורים בשרת בלבד ואינם מוצגים כאן.
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium">פרטי גישה</dt>
        <dd>{status.credentialsConfigured ? 'מוגדרים' : 'לא מוגדרים'}</dd>
        <dt className="font-medium">בדיקה מוצלחת אחרונה</dt>
        <dd>
          {status.lastSuccess ? formatIsraelDateTime(status.lastSuccess.at) : <span className="text-muted-foreground">אין</span>}
        </dd>
        <dt className="font-medium">שגיאה אחרונה</dt>
        <dd>
          {status.lastError ? (
            <>
              {formatIsraelDateTime(status.lastError.at)} ·{' '}
              {FAILURE_TEXT[status.lastError.failure ?? ''] ?? 'שגיאה'}
              {status.lastError.errorCode ? <span dir="ltr"> ({status.lastError.errorCode})</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">אין</span>
          )}
        </dd>
      </dl>

      <form action={action} className="space-y-2 rounded-lg border border-border p-4">
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">בדיקה מול המאגר לפני שיחות מכירה</p>
            <p className="text-sm text-muted-foreground">
              כשמופעל, שיחת מכירה למי שלא ביקש שיחזרו אליו נבדקת מול המאגר לפני החיוג. אישורי הגעה אינם נבדקים.
              כשהשירות אינו זמין, השיחה ממתינה ונבדקת שוב, ואינה מחויגת.
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="dnc_registry_gate_enabled"
                defaultChecked={status.gateEnabled}
                className="size-5 accent-primary"
              />
              מופעל
            </label>
            <SubmitButton className="w-auto">עדכון</SubmitButton>
          </div>
        </div>
      </form>
    </section>
  );
}
