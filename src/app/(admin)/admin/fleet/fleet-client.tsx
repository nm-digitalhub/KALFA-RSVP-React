'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import type { FleetGoalEntry, FleetRequestEntry } from '@/lib/data/admin/fleet';
import type { FleetRoleInfo } from '@/lib/fleet/handoff';
import {
  abandonFleetGoalAction,
  answerFleetRequestAction,
  createFleetGoalAction,
  createFleetRequestAction,
  pauseFleetGoalAction,
  resumeFleetGoalAction,
} from './actions';

// Local verdict submit: like the shared SubmitButton but carries the verdict
// as the button's name/value pair (one form, several verdicts) and supports
// the destructive tone for "deny". Base UI Buttons default to type="button",
// so type="submit" is explicit.
function VerdictButton({
  verdict,
  variant = 'default',
  children,
}: {
  verdict: 'approved' | 'denied' | 'answered';
  variant?: 'default' | 'destructive';
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="verdict" value={verdict} disabled={pending} variant={variant}>
      {pending ? 'רגע…' : children}
    </Button>
  );
}

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// When will the selected role actually SEE this write? Three different
// answers hide behind the same `pending`/`active` status, and the owner needs
// to know which one applies before they wait on a reply:
//   - reactive on the fast trigger -> the scheduler spawns it within a tick
//   - enabled with scheduled slots -> its next slot
//   - enabled with neither         -> only a manual run
//   - disabled                     -> never, until it is switched on
//
// `fastReactiveName` is the ONE thing that differs between callers:
// 'owner_direct_request' for a fleet request, 'goal_due' for a goal (§3.1).
// FleetRoleInfo.reactive is an array — a role can be reactive to more than
// one trigger at once (e.g. callback-triage answers callback_requests_pending
// AND goal_due). .includes(), not ===: reusing the fleet-request wording
// verbatim for goals would misreport reachability if it assumed only one.
function reachability(
  role: FleetRoleInfo | undefined,
  fastReactiveName: string,
  noun: 'הפנייה' | 'המטרה',
): {
  tone: 'ok' | 'warn' | 'blocked';
  text: string;
} {
  if (!role) return { tone: 'warn', text: `בחר סוכן כדי לראות מתי ${noun} תיקלט` };
  if (!role.enabled) {
    return {
      tone: 'blocked',
      text: `הסוכן כבוי — ${noun} תישמר ותמתין, אך לא תיקלט עד שיופעל ב-fleet.json`,
    };
  }
  if (role.reactive.includes(fastReactiveName)) {
    return { tone: 'ok', text: 'הסוכן ריאקטיבי לכך — ייקלט תוך כדקה' };
  }
  if (role.scheduleSlots > 0) {
    return { tone: 'ok', text: 'ייקלט בהרצה המתוזמנת הבאה של הסוכן' };
  }
  return {
    tone: 'warn',
    text: 'לסוכן אין לוח זמנים ואינו ריאקטיבי לכך — ייקלט רק בהרצה ידנית',
  };
}

const TONE_CLASS: Record<'ok' | 'warn' | 'blocked', string> = {
  ok: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-500',
  blocked: 'text-destructive',
};

// Owner -> agent. The counterpart to PendingRequestCard: that one answers a
// conversation an agent started, this one starts one.
//
// Native <select> on purpose — same choice as the contacts/callbacks admin
// forms: no portal, so no Base UI DirectionProvider dependency and no RTL
// pitfalls. Double submission is not guarded here by disabling the button
// alone: the request_key UNIQUE index makes an identical same-day ask
// idempotent in the DATABASE, and the action reports which of the two happened.
export function ComposeRequestCard({ roles }: { roles: FleetRoleInfo[] }) {
  const [state, action] = useActionState(createFleetRequestAction, null);
  const [selected, setSelected] = useState('');
  const uid = useId();
  const role = roles.find((r) => r.name === selected);
  const reach = reachability(selected ? role : undefined, 'owner_direct_request', 'הפנייה');

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">פנייה ישירה לסוכן</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          הסוכן יענה, יבקש הבהרה או יפתח בקשת אישור — בגבולות ההרשאות של הדרגה שלו.
          פעולה רגישה תמשיך לדרוש את אישורך.
        </p>
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-destructive">לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json</p>
      ) : (
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor={`${uid}-role`} className="mb-1 block text-sm font-medium">
                סוכן
              </label>
              <select
                id={`${uid}-role`}
                name="role"
                required
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className={selectClass}
              >
                <option value="">בחר…</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.enabled ? '' : ' (כבוי)'} · דרגה {r.tier}
                  </option>
                ))}
              </select>
              <FieldError errors={state?.fieldErrors?.role} />
            </div>

            <div>
              <label htmlFor={`${uid}-kind`} className="mb-1 block text-sm font-medium">
                סוג פנייה
              </label>
              <select id={`${uid}-kind`} name="kind" defaultValue="question" className={selectClass}>
                <option value="question">שאלה — מצפה לתשובה</option>
                <option value="approval">בקשת אישור</option>
                <option value="fyi">עדכון — לידיעה</option>
              </select>
              <FieldError errors={state?.fieldErrors?.kind} />
            </div>

            <div>
              <label htmlFor={`${uid}-tier`} className="mb-1 block text-sm font-medium">
                דרגת רגישות
              </label>
              <select id={`${uid}-tier`} name="tier" defaultValue="0" className={selectClass}>
                <option value="0">0 — דיווח</option>
                <option value="1">1 — קוד/בטא</option>
                <option value="2">2 — רגיש</option>
              </select>
              <FieldError errors={state?.fieldErrors?.tier} />
            </div>
          </div>

          <p className={`text-xs ${TONE_CLASS[reach.tone]}`}>{reach.text}</p>

          <div>
            <label htmlFor={`${uid}-title`} className="mb-1 block text-sm font-medium">
              כותרת
            </label>
            <input
              id={`${uid}-title`}
              name="title"
              required
              maxLength={200}
              className={inputClass}
              placeholder="במשפט אחד — מה נדרש מהסוכן"
            />
            <FieldError errors={state?.fieldErrors?.title} />
          </div>

          <div>
            <label htmlFor={`${uid}-body`} className="mb-1 block text-sm font-medium">
              תוכן
            </label>
            <textarea
              id={`${uid}-body`}
              name="body"
              rows={5}
              required
              maxLength={8000}
              className={inputClass}
              placeholder="ההקשר המלא, הגבולות, ומה נחשב 'סיימת'…"
            />
            <FieldError errors={state?.fieldErrors?.body} />
          </div>

          <p className="text-xs text-muted-foreground">
            דרגת הרגישות היא תיוג לפנייה — היא אינה מרחיבה את הרשאות הסוכן. מה שמותר לו
            נקבע בדרגה שלו ב-fleet.json וב-guard, ולא כאן.
          </p>

          <SubmitComposeButton disabled={reach.tone === 'blocked'}>שלח לסוכן</SubmitComposeButton>
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />
        </form>
      )}
    </section>
  );
}

function SubmitComposeButton({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'שולח…' : children}
    </Button>
  );
}

// Answer card for a single pending fleet request. The verdict is carried by
// the pressed submit button (name="verdict"): approval requests offer
// approve/deny, questions require a textual answer, FYIs just get acknowledged.

const KIND_LABEL: Record<string, string> = {
  approval: 'בקשת אישור',
  question: 'שאלה',
  fyi: 'עדכון',
};

const TIER_LABEL: Record<number, string> = {
  0: 'דרגה 0 — דיווח',
  1: 'דרגה 1 — קוד/בטא',
  2: 'דרגה 2 — רגיש',
};

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function formatDateTimeLabel(iso: string, formatted: string) {
  return <time dateTime={iso}>{formatted}</time>;
}

export function PendingRequestCard({
  request,
  createdAtLabel,
  expiresAtLabel,
}: {
  request: FleetRequestEntry;
  createdAtLabel: string;
  expiresAtLabel: string;
}) {
  const [state, action] = useActionState(answerFleetRequestAction, null);
  const preparedCommand =
    request.payload &&
    typeof request.payload === 'object' &&
    !Array.isArray(request.payload) &&
    typeof (request.payload as { prepared_command?: unknown }).prepared_command === 'string'
      ? ((request.payload as { prepared_command: string }).prepared_command)
      : null;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={request.kind === 'approval' ? 'warning' : 'secondary'}>
          {KIND_LABEL[request.kind] ?? request.kind}
        </Badge>
        <Badge variant={request.tier === 2 ? 'destructive' : 'outline'}>
          {TIER_LABEL[request.tier] ?? `דרגה ${request.tier}`}
        </Badge>
        <Badge variant="outline">{request.role}</Badge>
        <span className="ms-auto text-xs text-muted-foreground">
          {formatDateTimeLabel(request.created_at, createdAtLabel)}
        </span>
      </header>

      <div className="space-y-2">
        <h2 className="wrap-anywhere text-base font-semibold">
          <Link href={`/admin/fleet/${request.id}`} className="hover:underline">
            {request.title}
          </Link>
        </h2>
        {/* wrap-anywhere (not break-words): agent-authored bodies carry long
            unbreakable tokens (hashes/paths); only overflow-wrap:anywhere is
            factored into intrinsic sizing, so it stops the flex row from
            inflating past the viewport (iPad Safari zooms the page out). */}
        <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground">{request.body}</p>
        {preparedCommand ? (
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
          >
            <code>{preparedCommand}</code>
          </pre>
        ) : null}
        <p className="text-xs text-muted-foreground">בתוקף עד {expiresAtLabel}</p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={request.id} />
        <div>
          <label htmlFor={`answer-${request.id}`} className="mb-1 block text-sm font-medium">
            {request.kind === 'question' ? 'תשובה (חובה)' : 'הערה (אופציונלי)'}
          </label>
          <textarea
            id={`answer-${request.id}`}
            name="answer"
            rows={3}
            required={request.kind === 'question'}
            className={inputClass}
            placeholder={
              request.kind === 'question' ? 'כתוב את התשובה לסוכן…' : 'הנחיה נוספת לסוכן…'
            }
          />
          <FieldError errors={state?.fieldErrors?.answer} />
        </div>

        <div className="flex flex-wrap gap-2">
          {request.kind === 'approval' ? (
            <>
              <VerdictButton verdict="approved">אשר</VerdictButton>
              <VerdictButton verdict="denied" variant="destructive">
                דחה
              </VerdictButton>
            </>
          ) : (
            <VerdictButton verdict="answered">
              {request.kind === 'question' ? 'שלח תשובה' : 'אשר קריאה'}
            </VerdictButton>
          )}
        </div>
        <FormError message={state?.error} />
        <FormNotice message={state?.notice} />
      </form>
    </article>
  );
}

// ── Fleet goals ──────────────────────────────────────────────────────────────

// Owner -> agent, persistent. Structure mirrors ComposeRequestCard, including
// reuse of reachability() and SubmitComposeButton.
export function GoalComposeCard({ roles }: { roles: FleetRoleInfo[] }) {
  const [state, action] = useActionState(createFleetGoalAction, null);
  const [selected, setSelected] = useState('');
  const uid = useId();
  const role = roles.find((r) => r.name === selected);
  const reach = reachability(selected ? role : undefined, 'goal_due', 'המטרה');

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">מטרה חדשה</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          הסוכן ישמור מצב בין ריצות, יחליט על הצעד הבא, ויתזמן את עצמו עד שהמטרה
          תסתיים — בגבולות ההרשאות של הדרגה שלו. התיאור למטה הוא ההוראה היחידה
          שהוא יקבל, כולל מה נחשב &quot;הושלם&quot;.
        </p>
      </div>

      {roles.length === 0 ? (
        <p className="text-sm text-destructive">לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json</p>
      ) : (
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor={`${uid}-goal-role`} className="mb-1 block text-sm font-medium">
              סוכן
            </label>
            <select
              id={`${uid}-goal-role`}
              name="role"
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={selectClass}
            >
              <option value="">בחר…</option>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                  {r.enabled ? '' : ' (כבוי)'} · דרגה {r.tier}
                </option>
              ))}
            </select>
            <FieldError errors={state?.fieldErrors?.role} />
          </div>

          <p className={`text-xs ${TONE_CLASS[reach.tone]}`}>{reach.text}</p>

          <div>
            <label htmlFor={`${uid}-goal-title`} className="mb-1 block text-sm font-medium">
              כותרת
            </label>
            <input
              id={`${uid}-goal-title`}
              name="title"
              required
              maxLength={200}
              className={inputClass}
              placeholder="במשפט אחד — מה המטרה"
            />
            <FieldError errors={state?.fieldErrors?.title} />
          </div>

          <div>
            <label htmlFor={`${uid}-goal-body`} className="mb-1 block text-sm font-medium">
              תיאור
            </label>
            <textarea
              id={`${uid}-goal-body`}
              name="body"
              rows={5}
              required
              maxLength={8000}
              className={inputClass}
              placeholder='ההקשר המלא, הגבולות, ומה נחשב "הושלם"…'
            />
            <FieldError errors={state?.fieldErrors?.body} />
          </div>

          <SubmitComposeButton disabled={reach.tone === 'blocked'}>צור מטרה</SubmitComposeButton>
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />
        </form>
      )}
    </section>
  );
}

// Not VerdictButton (that needs name="verdict" to distinguish buttons WITHIN
// one form) and not the shared SubmitButton (no variant). The three goal
// actions are three separate Server Actions, each in its own form.
function GoalActionButton({
  variant = 'default',
  children,
}: {
  variant?: 'default' | 'destructive';
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} className="w-auto">
      {pending ? 'רגע…' : children}
    </Button>
  );
}

// No `note` field on purpose: pauseFleetGoal accepts an optional note, but v1
// does not surface it — the last failure is already visible via last_error
// on the card itself.
function PauseGoalForm({ goalId }: { goalId: string }) {
  const [state, action] = useActionState(pauseFleetGoalAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={goalId} />
      <GoalActionButton>השהה</GoalActionButton>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

function ResumeGoalForm({ goalId }: { goalId: string }) {
  const [state, action] = useActionState(resumeFleetGoalAction, null);
  // Empty on purpose. An empty field -> undefined -> the RPC's own default
  // (an hour from now).
  const [wakeLocal, setWakeLocal] = useState('');
  const uid = useId();

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={goalId} />
      <div>
        <label
          htmlFor={`${uid}-wake`}
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          מועד התעוררות (ריק = שעה מעכשיו)
        </label>
        <input
          id={`${uid}-wake`}
          type="datetime-local"
          value={wakeLocal}
          onChange={(e) => setWakeLocal(e.target.value)}
          className={inputClass}
        />
      </div>
      {/* The field actually sent. new Date(local) in the browser resolves by
          the user's own time zone — same as calendar-client.tsx. offset:true
          (goalWakeAtSchema) rejects anything that skipped this conversion. */}
      <input
        type="hidden"
        name="next_wake_at"
        value={wakeLocal ? new Date(wakeLocal).toISOString() : ''}
      />
      <GoalActionButton>שחרר</GoalActionButton>
      <FieldError errors={state?.fieldErrors?.nextWakeAt} />
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// note is required (abandonFleetGoal: min 3 chars) — a goal closed without a
// reason leaves a row nobody can explain a month from now. Available for any
// non-terminal status (active AND paused).
function AbandonGoalForm({ goalId }: { goalId: string }) {
  const [state, action] = useActionState(abandonFleetGoalAction, null);
  const uid = useId();
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={goalId} />
      <div>
        <label
          htmlFor={`${uid}-note`}
          className="mb-1 block text-xs font-medium text-muted-foreground"
        >
          סיבת הסגירה (חובה)
        </label>
        <input
          id={`${uid}-note`}
          name="note"
          required
          minLength={3}
          maxLength={500}
          className={inputClass}
          placeholder="למה המטרה כבר לא רלוונטית…"
        />
        <FieldError errors={state?.fieldErrors?.note} />
      </div>
      <GoalActionButton variant="destructive">סגור</GoalActionButton>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

const GOAL_STATUS_LABEL: Record<string, string> = {
  active: 'פעילה',
  paused: 'מושהית',
  completed: 'הושלמה',
  failed: 'נכשלה',
};

const GOAL_STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'info',
  paused: 'warning',
  completed: 'success',
  failed: 'destructive',
};

// A card, not a table row: a goal can show up to two forms at once
// (pause/resume + close, the latter with a text field) — the same shape
// PendingRequestCard already solves. The read-only history table has no forms
// and is not the right template here.
export function GoalCard({
  goal,
  createdAtLabel,
  nextWakeAtLabel,
}: {
  goal: FleetGoalEntry;
  createdAtLabel: string;
  nextWakeAtLabel: string | null;
}) {
  // Same pattern as preparedCommand in PendingRequestCard above: typeof/
  // Array.isArray before reading a field out of Json, not an assumed shape.
  const nextAction =
    goal.state &&
    typeof goal.state === 'object' &&
    !Array.isArray(goal.state) &&
    typeof (goal.state as { next_action?: unknown }).next_action === 'string'
      ? (goal.state as { next_action: string }).next_action
      : null;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={GOAL_STATUS_VARIANT[goal.status] ?? 'neutral'}>
          {GOAL_STATUS_LABEL[goal.status] ?? goal.status}
        </Badge>
        <Badge variant="outline">{goal.role}</Badge>
        <span className="text-xs text-muted-foreground">צעד {goal.step_count}</span>
        {goal.consecutive_failures > 0 ? (
          <span className={`text-xs ${TONE_CLASS.warn}`}>
            {goal.consecutive_failures} כשלים רצופים
          </span>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground">{createdAtLabel}</span>
      </header>

      <div className="space-y-2">
        <h2 className="wrap-anywhere text-base font-semibold">{goal.title}</h2>
        <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground">
          {goal.body}
        </p>
        {nextAction ? (
          <p className="wrap-anywhere text-sm">
            <span className="font-medium">הצעד הבא (לפי הסוכן): </span>
            {nextAction}
          </p>
        ) : null}
        {goal.last_error ? (
          <p className="wrap-anywhere text-sm text-destructive">שגיאה אחרונה: {goal.last_error}</p>
        ) : null}
        {goal.status === 'active' && nextWakeAtLabel ? (
          <p className="text-xs text-muted-foreground">יתעורר: {nextWakeAtLabel}</p>
        ) : null}
      </div>

      {/* completed/failed: terminal, no actions — the combined condition
          skips the whole block */}
      {goal.status === 'active' || goal.status === 'paused' ? (
        <div className="flex flex-wrap items-start gap-4 border-t border-border pt-4">
          {goal.status === 'active' ? <PauseGoalForm goalId={goal.id} /> : null}
          {goal.status === 'paused' ? <ResumeGoalForm goalId={goal.id} /> : null}
          <AbandonGoalForm goalId={goal.id} />
        </div>
      ) : null}
    </article>
  );
}
