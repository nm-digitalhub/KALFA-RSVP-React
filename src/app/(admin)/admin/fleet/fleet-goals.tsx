'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { LocalDateTime } from '@/components/local-date-time';
import { useIsMobile } from '@/hooks/use-mobile';
import type { FleetGoalEntry } from '@/lib/data/admin/fleet';
import { GOAL_STATUS_LABEL, GOAL_STATUS_VARIANT } from '@/lib/fleet/labels';
import type { Reachability } from '@/lib/fleet/reachability';
import { cn } from '@/lib/utils';
import {
  abandonFleetGoalAction,
  createFleetGoalAction,
  pauseFleetGoalAction,
  resumeFleetGoalAction,
} from './actions';

// Goals inside a conversation (plan D7): a pinned strip at the top of the
// conversation ONLY while a goal is active or paused, a Sheet from the
// composer's goal button to start one, and system lines in the stream when a goal
// opens or closes (rendered by the stream, not here).

// ── Pinned strip ─────────────────────────────────────────────────────────────
// Collapsible via useState + conditional render — not Base UI Collapsible and
// not a DropdownMenu: the card holds real inputs (a datetime, a required
// reason), which do not work inside menu items.
export function GoalStrip({ goals }: { goals: FleetGoalEntry[] }) {
  const open = goals.filter((g) => g.status === 'active' || g.status === 'paused');
  if (open.length === 0) return null;
  return (
    <div className="shrink-0 divide-y divide-border border-b border-border">
      {open.map((goal) => (
        <GoalStripItem key={goal.id} goal={goal} />
      ))}
    </div>
  );
}

function nextActionOf(goal: FleetGoalEntry): string | null {
  return goal.state &&
    typeof goal.state === 'object' &&
    !Array.isArray(goal.state) &&
    typeof (goal.state as { next_action?: unknown }).next_action === 'string'
    ? (goal.state as { next_action: string }).next_action
    : null;
}

function GoalStripItem({ goal }: { goal: FleetGoalEntry }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const nextAction = nextActionOf(goal);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-start outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium wrap-anywhere">{goal.title}</span>
            <Badge variant={GOAL_STATUS_VARIANT[goal.status] ?? 'neutral'}>
              {GOAL_STATUS_LABEL[goal.status] ?? goal.status}
            </Badge>
          </span>
          <span className="block text-xs text-muted-foreground">
            צעד {goal.step_count}
            {goal.status === 'active' && goal.next_wake_at ? (
              <>
                {' '}
                · יתעורר <LocalDateTime iso={goal.next_wake_at} />
              </>
            ) : null}
          </span>
          {nextAction ? (
            <span className="block text-xs text-foreground wrap-anywhere">הצעד הבא: {nextAction}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div id={panelId} className="px-4 pb-4">
          <GoalCard goal={goal} />
        </div>
      ) : null}
    </div>
  );
}

// ── New goal (from the composer's goal button) ───────────────────────────────
// `side` is physical in sheet.tsx: "left" is the inline END in RTL on desktop;
// a bottom sheet on phones. Portaled content takes its direction from the
// root DirectionProvider — not re-wrapped here.
export function NewGoalSheet({
  role,
  reach,
  disabled,
}: {
  role: string;
  reach: Reachability;
  disabled: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createFleetGoalAction, null);
  const uid = useId();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button type="button" variant="ghost" size="icon-lg" disabled={disabled} className="size-11" />
        }
        aria-label="מטרה מתמשכת חדשה"
      >
        <Target aria-hidden />
      </SheetTrigger>
      <SheetContent side={isMobile ? 'bottom' : 'left'} className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>מטרה מתמשכת ל-<bdi dir="ltr">{role}</bdi></SheetTitle>
          <SheetDescription>
            מטרה נשארת פתוחה והסוכן מתקדם בה בין ריצות עד שהיא מסתיימת — בגבולות ההרשאות של
            הדרגה שלו.
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="space-y-4 px-4 pb-4">
          <input type="hidden" name="role" value={role} />
          <div className="space-y-1">
            <label htmlFor={`${uid}-title`} className="block text-sm font-medium">
              כותרת
            </label>
            <Input
              id={`${uid}-title`}
              name="title"
              required
              minLength={3}
              maxLength={200}
              placeholder="במשפט אחד — מה המטרה"
            />
            <FieldError errors={state?.fieldErrors?.title} />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-body`} className="block text-sm font-medium">
              תיאור
            </label>
            <Textarea
              id={`${uid}-body`}
              name="body"
              rows={5}
              required
              minLength={10}
              maxLength={8000}
              placeholder='ההקשר המלא, הגבולות, ומה נחשב "הושלם"…'
            />
            <FieldError errors={state?.fieldErrors?.body} />
          </div>
          {/* computed for the goal_due trigger, not owner_direct_request */}
          <p className={cn('text-xs', reach.tone === 'ok' ? 'text-muted-foreground' : reach.tone === 'warn' ? 'text-warning' : 'text-destructive')}>
            {reach.text}
          </p>
          <SubmitButton>צור מטרה</SubmitButton>
          <FormError message={state?.error} />
          <FormNotice message={state?.notice} />
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── Lifecycle of an existing goal: pause / resume / abandon ─────────────────

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
        <Input
          id={`${uid}-wake`}
          type="datetime-local"
          value={wakeLocal}
          onChange={(e) => setWakeLocal(e.target.value)}
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
        <Input
          id={`${uid}-note`}
          name="note"
          required
          minLength={3}
          maxLength={500}
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

// goal.last_error is an overloaded column: fleet_goal_close writes its closing
// note there via p_note REGARDLESS of status, so a goal that finished
// successfully carries its summary in the same field a real failure would.
// The label and tone therefore follow the goal's own status instead of
// assuming an error.
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
// (pause/resume + close, the latter with a text field).
function GoalCard({ goal }: { goal: FleetGoalEntry }) {
  // typeof/Array.isArray before reading a field out of Json, not an assumed
  // shape.
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
            <span className="text-xs text-warning">
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
            GOAL_NOTE_* maps above), so "completed" does not read like "failed".
            Label and body sit on separate lines with relaxed leading:
            agent-written reports are often one long unbroken paragraph of
            stats, which reads as cramped at a tight line-height. */}
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
        <div className="flex flex-wrap items-start gap-4 border-t border-border pt-4">
            {goal.status === 'active' ? (
              <PauseGoalForm goalId={goal.id} />
            ) : null}
            {goal.status === 'paused' ? (
              <ResumeGoalForm goalId={goal.id} />
            ) : null}
            <AbandonGoalForm goalId={goal.id} />
          </div>
      ) : null}
    </article>
  );
}
