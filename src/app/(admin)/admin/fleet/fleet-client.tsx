'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { FieldError, FormError, FormNotice } from '@/components/forms';
import { LocalDateTime } from '@/components/local-date-time';
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
    <Button
      type="submit"
      name="verdict"
      value={verdict}
      disabled={pending}
      variant={variant}
    >
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
export function reachability(
  role: FleetRoleInfo | undefined,
  fastReactiveName: string,
  noun: 'הפנייה' | 'המטרה',
): {
  tone: 'ok' | 'warn' | 'blocked';
  text: string;
} {
  if (!role)
    return { tone: 'warn', text: `בחר סוכן כדי לראות מתי ${noun} תיקלט` };
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
  warn: 'text-warning',
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
  const reach = reachability(
    selected ? role : undefined,
    'owner_direct_request',
    'הפנייה',
  );

  return (
    <Collapsible
      defaultOpen={false}
      className="rounded-lg border border-border bg-card"
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-start justify-between gap-4 p-5 text-start">
        <div>
          <h2 className="text-lg font-semibold">פנייה ישירה לסוכן</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            הסוכן יענה, יבקש הבהרה או יפתח בקשת אישור — בגבולות ההרשאות של הדרגה
            שלו. פעולה רגישה תמשיך לדרוש את אישורך.
          </p>
        </div>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-180" />
      </CollapsibleTrigger>

      <CollapsiblePanel className="space-y-4 px-5 pb-5">
        {roles.length === 0 ? (
          <p className="text-sm text-destructive">
            לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json
          </p>
        ) : (
          <form action={action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor={`${uid}-role`}
                  className="mb-1 block text-sm font-medium"
                >
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
                <label
                  htmlFor={`${uid}-kind`}
                  className="mb-1 block text-sm font-medium"
                >
                  סוג פנייה
                </label>
                <select
                  id={`${uid}-kind`}
                  name="kind"
                  defaultValue="question"
                  className={selectClass}
                >
                  <option value="question">שאלה — מצפה לתשובה</option>
                  <option value="approval">בקשת אישור</option>
                  <option value="fyi">עדכון — לידיעה</option>
                </select>
                <FieldError errors={state?.fieldErrors?.kind} />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-tier`}
                  className="mb-1 block text-sm font-medium"
                >
                  דרגת רגישות
                </label>
                <select
                  id={`${uid}-tier`}
                  name="tier"
                  defaultValue="0"
                  className={selectClass}
                >
                  <option value="0">0 — דיווח</option>
                  <option value="1">1 — קוד/בטא</option>
                  <option value="2">2 — רגיש</option>
                </select>
                <FieldError errors={state?.fieldErrors?.tier} />
              </div>
            </div>

            <p className={`text-xs ${TONE_CLASS[reach.tone]}`}>{reach.text}</p>

            <div>
              <label
                htmlFor={`${uid}-title`}
                className="mb-1 block text-sm font-medium"
              >
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
              <label
                htmlFor={`${uid}-body`}
                className="mb-1 block text-sm font-medium"
              >
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
              דרגת הרגישות היא תיוג לפנייה — היא אינה מרחיבה את הרשאות הסוכן. מה
              שמותר לו נקבע בדרגה שלו ב-fleet.json וב-guard, ולא כאן.
            </p>

            <SubmitComposeButton disabled={reach.tone === 'blocked'}>
              שלח לסוכן
            </SubmitComposeButton>
            <FormError message={state?.error} />
            <FormNotice message={state?.notice} />
          </form>
        )}
      </CollapsiblePanel>
    </Collapsible>
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

// Reply to an existing, no-longer-pending request from its detail page
// (/admin/fleet/[id]) — reuses createFleetRequestAction as-is (role/tier/
// threadRoot travel as hidden fields, not owner-editable) so this is a
// continuation of a specific conversation, not a fresh unrelated ask under a
// new role/tier. threadRoot is the id shared by every message in the
// conversation: the caller passes the existing payload.thread_root when this
// request is itself already a reply, or this request's own id when it is the
// first one being replied to — see fleet_owner_request's migration comment
// on why a single shared value (not a parent pointer) keeps the whole thread
// reconstructable from one field.
export function ReplyToRequestForm({
  role,
  tier,
  threadRoot,
  roles,
}: {
  role: string;
  tier: number;
  threadRoot: string;
  roles: FleetRoleInfo[];
}) {
  const [state, action] = useActionState(createFleetRequestAction, null);
  const uid = useId();
  const reach = reachability(
    roles.find((r) => r.name === role),
    'owner_direct_request',
    'הפנייה',
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="threadRoot" value={threadRoot} />

      <p className={`text-xs ${TONE_CLASS[reach.tone]}`}>{reach.text}</p>

      <div>
        <label
          htmlFor={`${uid}-kind`}
          className="mb-1 block text-sm font-medium"
        >
          סוג פנייה
        </label>
        <select
          id={`${uid}-kind`}
          name="kind"
          defaultValue="question"
          className={selectClass}
        >
          <option value="question">שאלה — מצפה לתשובה</option>
          <option value="approval">בקשת אישור</option>
          <option value="fyi">עדכון — לידיעה</option>
        </select>
        <FieldError errors={state?.fieldErrors?.kind} />
      </div>

      <div>
        <label
          htmlFor={`${uid}-title`}
          className="mb-1 block text-sm font-medium"
        >
          כותרת
        </label>
        <input
          id={`${uid}-title`}
          name="title"
          required
          maxLength={200}
          className={inputClass}
          placeholder="במשפט אחד — על מה ההמשך"
        />
        <FieldError errors={state?.fieldErrors?.title} />
      </div>

      <div>
        <label
          htmlFor={`${uid}-body`}
          className="mb-1 block text-sm font-medium"
        >
          תוכן
        </label>
        <textarea
          id={`${uid}-body`}
          name="body"
          rows={4}
          required
          maxLength={8000}
          className={inputClass}
          placeholder="ההמשך לשיחה עם הסוכן…"
        />
        <FieldError errors={state?.fieldErrors?.body} />
      </div>

      <SubmitComposeButton disabled={reach.tone === 'blocked'}>
        שלח המשך
      </SubmitComposeButton>
      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />
    </form>
  );
}

// Answer card for a single pending fleet request. The verdict is carried by
// the pressed submit button (name="verdict"): approval requests offer
// approve/deny, questions require a textual answer, FYIs just get acknowledged.

// Single source for request "kind" — previously three separately-maintained
// copies (this file, page.tsx, [id]/page.tsx) had drifted to two different
// wordings for the same values. Exported so both pages import instead of
// re-declaring. KIND_VARIANT didn't exist before: question and fyi rendered
// as the identical `secondary` badge despite very different urgency (a
// question blocks on the owner; an fyi doesn't) — approval already got its
// own `warning` tone inline at the one call site that needed it.
export const KIND_LABEL: Record<string, string> = {
  approval: 'בקשת אישור',
  question: 'שאלה',
  fyi: 'עדכון',
};

export const KIND_VARIANT: Record<string, BadgeVariant> = {
  approval: 'warning',
  question: 'info',
  fyi: 'neutral',
};

const TIER_LABEL: Record<number, string> = {
  0: 'דרגה 0 — דיווח',
  1: 'דרגה 1 — קוד/בטא',
  2: 'דרגה 2 — רגיש',
};

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// `linkToDetail`: PendingRequestCard is reused verbatim on the detail page
// itself (/admin/fleet/[id]) for a still-pending request — there, the title
// linking to the very page you're already on was a dead self-link.
export function PendingRequestCard({
  request,
  linkToDetail = true,
}: {
  request: FleetRequestEntry;
  linkToDetail?: boolean;
}) {
  const [state, action] = useActionState(answerFleetRequestAction, null);
  // react-hooks/purity: Date.now() may not run during render. useState's lazy
  // initializer is React's sanctioned impure-init boundary — captured once per
  // mount, same fix as event-calendar-event.tsx:443. "expiring soon" is a
  // styling hint, not a source of truth, so a staleness window of minutes
  // (until the card next remounts) is fine.
  const [mountedAtMs] = useState(() => Date.now());
  const preparedCommand =
    request.payload &&
    typeof request.payload === 'object' &&
    !Array.isArray(request.payload) &&
    typeof (request.payload as { prepared_command?: unknown })
      .prepared_command === 'string'
      ? (request.payload as { prepared_command: string }).prepared_command
      : null;
  // A reply within an existing conversation carries thread_root; the first
  // message in a thread does not (its own id becomes the root once replied
  // to) — see threadRootOf in [id]/page.tsx for the same check server-side.
  const isThreadContinuation =
    request.payload &&
    typeof request.payload === 'object' &&
    !Array.isArray(request.payload) &&
    typeof (request.payload as { thread_root?: unknown }).thread_root ===
      'string';
  const hoursToExpiry =
    (new Date(request.expires_at).getTime() - mountedAtMs) / 3_600_000;
  const isExpiringSoon = hoursToExpiry > 0 && hoursToExpiry < 24;

  return (
    <article className="space-y-4 rounded-lg border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant={KIND_VARIANT[request.kind] ?? 'secondary'}>
          {KIND_LABEL[request.kind] ?? request.kind}
        </Badge>
        <Badge variant={request.tier === 2 ? 'destructive' : 'outline'}>
          {TIER_LABEL[request.tier] ?? `דרגה ${request.tier}`}
        </Badge>
        <Badge variant="outline">{request.role}</Badge>
        {isThreadContinuation ? <Badge variant="info">המשך שיחה</Badge> : null}
        {isExpiringSoon ? (
          <Badge variant="destructive">פג תוקף בקרוב</Badge>
        ) : null}
        <span className="ms-auto text-xs text-muted-foreground">
          <LocalDateTime iso={request.created_at} />
        </span>
      </header>

      <div className="space-y-2">
        <h3 className="wrap-anywhere text-base font-semibold">
          {linkToDetail ? (
            <Link
              href={`/admin/fleet/${request.id}`}
              className="hover:underline"
            >
              {request.title}
            </Link>
          ) : (
            request.title
          )}
        </h3>
        {/* wrap-anywhere (not break-words): agent-authored bodies carry long
            unbreakable tokens (hashes/paths); only overflow-wrap:anywhere is
            factored into intrinsic sizing, so it stops the flex row from
            inflating past the viewport (iPad Safari zooms the page out). */}
        <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground">
          {request.body}
        </p>
        {preparedCommand ? (
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
          >
            <code>{preparedCommand}</code>
          </pre>
        ) : null}
        <p className="text-xs text-muted-foreground">
          בתוקף עד <LocalDateTime iso={request.expires_at} />
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={request.id} />
        <div>
          <label
            htmlFor={`answer-${request.id}`}
            className="mb-1 block text-sm font-medium"
          >
            {request.kind === 'question' ? 'תשובה (חובה)' : 'הערה (אופציונלי)'}
          </label>
          <textarea
            id={`answer-${request.id}`}
            name="answer"
            rows={3}
            required={request.kind === 'question'}
            className={inputClass}
            placeholder={
              request.kind === 'question'
                ? 'כתוב את התשובה לסוכן…'
                : 'הנחיה נוספת לסוכן…'
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
    <Collapsible
      defaultOpen={false}
      className="rounded-lg border border-border bg-card"
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-start justify-between gap-4 p-5 text-start">
        <div>
          <h2 className="text-lg font-semibold">מטרה חדשה</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            הסוכן ישמור מצב בין ריצות, יחליט על הצעד הבא, ויתזמן את עצמו עד
            שהמטרה תסתיים — בגבולות ההרשאות של הדרגה שלו. התיאור למטה הוא ההוראה
            היחידה שהוא יקבל, כולל מה נחשב &quot;הושלם&quot;.
          </p>
        </div>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-180" />
      </CollapsibleTrigger>

      <CollapsiblePanel className="space-y-4 px-5 pb-5">
        {roles.length === 0 ? (
          <p className="text-sm text-destructive">
            לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json
          </p>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <label
                htmlFor={`${uid}-goal-role`}
                className="mb-1 block text-sm font-medium"
              >
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
              <label
                htmlFor={`${uid}-goal-title`}
                className="mb-1 block text-sm font-medium"
              >
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
              <label
                htmlFor={`${uid}-goal-body`}
                className="mb-1 block text-sm font-medium"
              >
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

            <SubmitComposeButton disabled={reach.tone === 'blocked'}>
              צור מטרה
            </SubmitComposeButton>
            <FormError message={state?.error} />
            <FormNotice message={state?.notice} />
          </form>
        )}
      </CollapsiblePanel>
    </Collapsible>
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
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      className="w-auto"
    >
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

// Feedback on an in-progress goal — goal.body is fixed at creation and
// fleet_goal_pause/abandon's own note field is never injected into the
// agent's run-context (verified: cmdGoalPoll's SELECT doesn't carry
// last_error, and run-context.sh's goal block doesn't echo it either), so
// there is no existing channel for "regarding what you just did, also do X"
// on a goal that's still running. Reusing createFleetRequestAction (same
// action as ReplyToRequestForm above) rather than adding a goal-specific
// RPC: fleet_owner_request already lands in the target role's `inbox`,
// which run-context.sh injects and instructs every role to handle FIRST,
// before its routine work (the goal included) — so this reaches the agent
// through a path that already exists and is already tested, no migration
// required. The link to the goal is by TITLE TEXT, not a foreign key
// (fleet_owner_request has no goal_id parameter) — deliberately: the agent
// reads the active goal's own title in the same run-context injection, so a
// request titled after it is unambiguous to the agent even without a DB
// link, and adding one would mean altering a SECURITY DEFINER RPC for
// marginal benefit over a request list that already shows the same title.
export function ReplyToGoalForm({
  role,
  goalId,
  goalTitle,
}: {
  role: string;
  goalId: string;
  goalTitle: string;
}) {
  const [state, action] = useActionState(createFleetRequestAction, null);
  const uid = useId();

  return (
    <form action={action} className="space-y-3 border-t border-border pt-4">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="tier" value="0" />
      <p className="text-xs text-muted-foreground">
        נשלח כפנייה נפרדת ל-{role} — הסוכן יראה אותה ב-inbox שלו ויטפל בה{' '}
        <strong>לפני</strong> שהוא ממשיך על המטרה (מזהה מטרה:{' '}
        <code dir="ltr">{goalId}</code>).
      </p>

      <div>
        <label
          htmlFor={`${uid}-kind`}
          className="mb-1 block text-sm font-medium"
        >
          סוג פנייה
        </label>
        <select
          id={`${uid}-kind`}
          name="kind"
          defaultValue="fyi"
          className={selectClass}
        >
          <option value="question">שאלה — מצפה לתשובה</option>
          <option value="approval">בקשת אישור</option>
          <option value="fyi">עדכון — לידיעה</option>
        </select>
        <FieldError errors={state?.fieldErrors?.kind} />
      </div>

      <div>
        <label
          htmlFor={`${uid}-title`}
          className="mb-1 block text-sm font-medium"
        >
          כותרת
        </label>
        <input
          id={`${uid}-title`}
          name="title"
          required
          maxLength={200}
          defaultValue={`בהמשך למטרה: ${goalTitle}`}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.title} />
      </div>

      <div>
        <label
          htmlFor={`${uid}-body`}
          className="mb-1 block text-sm font-medium"
        >
          תוכן
        </label>
        <textarea
          id={`${uid}-body`}
          name="body"
          rows={4}
          required
          maxLength={8000}
          className={inputClass}
          placeholder="מה ברצונך להוסיף או לשאול לגבי המטרה הזו…"
        />
        <FieldError errors={state?.fieldErrors?.body} />
      </div>

      <SubmitComposeButton disabled={false}>שלח הגבה</SubmitComposeButton>
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

// goal.last_error is an overloaded column: fleet_goal_close writes its closing
// note there via p_note REGARDLESS of status (§1.7), so a goal that finished
// successfully carries its summary in the same field a real failure would.
// Labeling and coloring it as "error" unconditionally made every completed
// goal read as if something had broken — the tone now follows the goal's own
// status instead of assuming the worst.
const GOAL_NOTE_LABEL: Record<string, string> = {
  active: 'שגיאה אחרונה (הסוכן ממשיך):',
  paused: 'שגיאה שהובילה להשהיה:',
  completed: 'סיכום:',
  failed: 'שגיאה:',
};

const GOAL_NOTE_BOX_TONE: Record<string, string> = {
  active: 'border-warning/20 bg-warning/5',
  paused: 'border-warning/20 bg-warning/5',
  completed: 'border-border bg-muted/40',
  failed: 'border-destructive/20 bg-destructive/5',
};

const GOAL_NOTE_LABEL_TONE: Record<string, string> = {
  active: 'text-warning',
  paused: 'text-warning',
  completed: 'text-muted-foreground',
  failed: 'text-destructive',
};

// A card, not a table row: a goal can show up to two forms at once
// (pause/resume + close, the latter with a text field) — the same shape
// PendingRequestCard already solves. The read-only history table has no forms
// and is not the right template here.
export function GoalCard({ goal }: { goal: FleetGoalEntry }) {
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
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={GOAL_STATUS_VARIANT[goal.status] ?? 'neutral'}>
            {GOAL_STATUS_LABEL[goal.status] ?? goal.status}
          </Badge>
          <Badge variant="outline">{goal.role}</Badge>
          {goal.consecutive_failures > 0 ? (
            <span className={`text-xs ${TONE_CLASS.warn}`}>
              {goal.consecutive_failures} כשלים רצופים
            </span>
          ) : null}
        </div>
        {/* Secondary, quieter metadata — separated from the status/role badges
            above so the card leads with "what is this and how did it go", not
            a wall of equally-weighted chips. */}
        <p className="text-xs text-muted-foreground">
          צעד {goal.step_count} · <LocalDateTime iso={goal.created_at} />
        </p>
      </header>

      <div className="space-y-4">
        <div>
          <h3 className="wrap-anywhere text-base font-semibold">
            {goal.title}
          </h3>
          <p className="wrap-anywhere mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {goal.body}
          </p>
        </div>

        {nextAction ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              הצעד הבא (לפי הסוכן)
            </p>
            <p className="wrap-anywhere mt-1 text-sm leading-relaxed">
              {nextAction}
            </p>
          </div>
        ) : null}

        {/* Boxed and tone-matched to the goal's actual status (see the three
            GOAL_NOTE_* maps above) — this is where "completed" used to render
            identically to "failed", both in alarming red. Label and body sit
            on separate lines with relaxed leading: agent-written reports are
            often one long unbroken paragraph of stats, and that reads as
            cramped at the previous tight line-height with no room around it. */}
        {goal.last_error ? (
          <div
            className={`rounded-md border p-4 ${
              GOAL_NOTE_BOX_TONE[goal.status] ?? GOAL_NOTE_BOX_TONE.active
            }`}
          >
            <p
              className={`text-xs font-semibold ${GOAL_NOTE_LABEL_TONE[goal.status] ?? GOAL_NOTE_LABEL_TONE.active}`}
            >
              {GOAL_NOTE_LABEL[goal.status] ?? GOAL_NOTE_LABEL.active}
            </p>
            <p className="wrap-anywhere mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {goal.last_error}
            </p>
          </div>
        ) : null}

        {goal.status === 'active' && goal.next_wake_at ? (
          <p className="text-xs text-muted-foreground">
            יתעורר: <LocalDateTime iso={goal.next_wake_at} />
          </p>
        ) : null}
      </div>

      {/* completed/failed: terminal, no actions — the combined condition
          skips the whole block */}
      {goal.status === 'active' || goal.status === 'paused' ? (
        <>
          <div className="flex flex-wrap items-start gap-4 border-t border-border pt-4">
            {goal.status === 'active' ? (
              <PauseGoalForm goalId={goal.id} />
            ) : null}
            {goal.status === 'paused' ? (
              <ResumeGoalForm goalId={goal.id} />
            ) : null}
            <AbandonGoalForm goalId={goal.id} />
          </div>
          <ReplyToGoalForm
            role={goal.role}
            goalId={goal.id}
            goalTitle={goal.title}
          />
        </>
      ) : null}
    </article>
  );
}
