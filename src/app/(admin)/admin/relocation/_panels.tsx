import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Circle,
  LoaderCircle,
  Undo2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { BadgeVariant } from '@/components/ui/badge';
import { Badge, EmptyState, formatDateTime } from '../_components';
import type {
  RelocationGateView,
  RelocationRunView,
  RelocationStepView,
} from '@/lib/data/admin/relocation';
import type { RunPhase, StepStatus } from '@/lib/relocation/state';

// Server-rendered presentational panels for /admin/relocation. The page is a
// read-only WINDOW into the CLI wizard's state file — nothing here mutates
// anything, and every decision callout says explicitly that decisions happen
// in the CLI. Hebrew copy per docs/relocation-wizard-design-2026-08-23.md §4.

const PHASE_LABEL: Record<RunPhase, string> = {
  planning: 'בתכנון',
  executing: 'מתבצע',
  waiting: 'ממתין',
  blocked: 'חסום',
  'rolling-back': 'מבצע Rollback',
  done: 'הושלם',
  failed: 'נכשל',
  aborted: 'בוטל',
};

const PHASE_VARIANT: Record<RunPhase, BadgeVariant> = {
  planning: 'info',
  executing: 'info',
  waiting: 'warning',
  blocked: 'warning',
  'rolling-back': 'warning',
  done: 'success',
  failed: 'destructive',
  aborted: 'neutral',
};

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'ממתין לתור',
  running: 'רץ כעת',
  'waiting-external': 'ממתין לגורם חיצוני',
  'needs-decision': 'ממתין להחלטה',
  done: 'הושלם',
  skipped: 'דולג',
  failed: 'נכשל',
  'rolled-back': 'שוחזר',
};

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />;
    case 'running':
      return <LoaderCircle className="size-4 shrink-0 animate-spin text-info" aria-hidden />;
    case 'waiting-external':
    case 'needs-decision':
      return <CircleHelp className="size-4 shrink-0 text-warning" aria-hidden />;
    case 'failed':
      return <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />;
    case 'rolled-back':
      return <Undo2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
    case 'skipped':
      return <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
    default:
      return <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
}

// Coarse Hebrew elapsed-time text, computed server-side (the page is
// force-dynamic and refreshes via the toggle — no client clock, no hydration
// mismatch).
function elapsedHe(fromIso: string, now: Date): string | null {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (minutes < 1) return 'פחות מדקה';
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} שעות`;
  return `${Math.floor(hours / 24)} ימים`;
}

export function NoRunEmptyState() {
  return (
    <EmptyState>
      לא בוצעה העברת דומיין. מריצים{' '}
      <code dir="ltr" className="rounded bg-muted px-1 py-0.5 text-xs">
        npm run relocate
      </code>{' '}
      בשרת — ההתקדמות תוצג כאן.
    </EmptyState>
  );
}

export function UnreadableAlert() {
  return (
    <Alert>
      <CircleHelp aria-hidden />
      <AlertTitle>קובץ המצב אינו קריא כרגע</AlertTitle>
      <AlertDescription>ייתכן שכתיבה מתבצעת ברגע זה — רעננו את העמוד.</AlertDescription>
    </Alert>
  );
}

export function UnsupportedVersionAlert() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>גרסת קובץ מצב לא נתמכת</AlertTitle>
      <AlertDescription>
        קובץ המצב נכתב על ידי גרסת אשף חדשה יותר מהעמוד הזה. יש לפרוס את האפליקציה המעודכנת.
      </AlertDescription>
    </Alert>
  );
}

export function RunHeaderCard({ run }: { run: RelocationRunView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>
            {run.flavor === 'install' ? 'התקנה מלאה בכתובת' : 'העברה אל'}{' '}
            <span dir="ltr" className="font-mono text-sm">
              {run.targetOrigin}
            </span>
          </span>
          <Badge variant={PHASE_VARIANT[run.phase]}>{PHASE_LABEL[run.phase]}</Badge>
          {run.mode === 'dry-run' ? <Badge variant="info">הרצת ניסיון (dry-run)</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {run.flavor === 'relocate' ? (
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">מהכתובת:</dt>
              <dd dir="ltr" className="font-mono text-xs leading-5">
                {run.previousOrigin}
              </dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">מזהה ריצה:</dt>
            <dd dir="ltr" className="font-mono text-xs leading-5">
              {run.runId}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">התחילה:</dt>
            <dd>{formatDateTime(run.createdAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-foreground">עדכון אחרון:</dt>
            <dd>{formatDateTime(run.updatedAt)}</dd>
          </div>
        </dl>

        {run.writerStale ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>תהליך האשף אינו מגיב</AlertTitle>
            <AlertDescription>
              לא התקבל דופק מתהליך האשף למעלה משתי דקות בזמן ביצוע — יש לבדוק בשרת.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProgressPanel({ run }: { run: RelocationRunView }) {
  const { done, total } = run.progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">התקדמות</span>
          <span className="text-muted-foreground">
            {done} מתוך {total} צעדים הושלמו
          </span>
        </div>
        <Progress
          value={pct}
          variant={run.phase === 'failed' ? 'destructive' : run.phase === 'done' ? 'success' : 'default'}
          aria-label={`התקדמות: ${done} מתוך ${total} צעדים`}
        />
      </CardContent>
    </Card>
  );
}

export function OpenGatesPanel({ gates }: { gates: RelocationGateView[] }) {
  const open = gates.filter((gate) => gate.status === 'open');
  if (open.length === 0) return null;
  return (
    <div className="space-y-3">
      {open.map((gate) => (
        <Alert key={gate.id} variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>ממתין להחלטה בטרמינל: {gate.label.he}</AlertTitle>
          <AlertDescription>
            {gate.consequence.he} ההחלטה מתקבלת בהרצת האשף בשרת בלבד — העמוד הזה לצפייה
            בלבד ואינו מבצע דבר.
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function StepRow({ step, now }: { step: RelocationStepView; now: Date }) {
  const waitingElapsed =
    step.waiting && step.startedAt ? elapsedHe(step.startedAt, now) : null;
  return (
    <li className="flex flex-col gap-1 border-s-2 border-border ps-4 pb-4 last:pb-0">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <StepStatusIcon status={step.status} />
        <span dir="ltr" className="font-mono text-xs text-muted-foreground">
          {step.id}
        </span>
        {step.label.he}
        <Badge>{STEP_STATUS_LABEL[step.status]}</Badge>
        {step.attempt > 1 ? (
          <span className="text-xs text-muted-foreground">ניסיון {step.attempt}</span>
        ) : null}
      </span>
      {step.startedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(step.startedAt)}
          {step.endedAt ? ` — ${formatDateTime(step.endedAt)}` : ''}
        </span>
      ) : null}

      {step.waiting ? (
        <Alert>
          <CircleHelp aria-hidden />
          <AlertTitle>
            {step.waiting.detail.he}
            {waitingElapsed ? ` — ממתין כבר ${waitingElapsed}` : ''}
          </AlertTitle>
          <AlertDescription>
            ניסיון {step.waiting.attempts}; בדיקה הבאה: {formatDateTime(step.waiting.nextPollAt)}
          </AlertDescription>
        </Alert>
      ) : null}

      {step.error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>{step.error.message}</AlertTitle>
          {step.error.hint ? <AlertDescription>{step.error.hint.he}</AlertDescription> : null}
        </Alert>
      ) : null}

      {step.verification && step.verification.checks.length > 0 ? (
        <Table className="mt-1">
          <TableHeader>
            <TableRow>
              <TableHead>בדיקה</TableHead>
              <TableHead>תוצאה</TableHead>
              <TableHead>פרטים</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {step.verification.checks.map((check, i) => (
              <TableRow key={i}>
                <TableCell>{check.label.he}</TableCell>
                <TableCell>
                  <Badge variant={check.ok ? 'success' : 'destructive'}>
                    {check.ok ? 'עבר' : 'נכשל'}
                  </Badge>
                </TableCell>
                <TableCell dir="ltr" className="font-mono text-xs">
                  {check.detail ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </li>
  );
}

export function StageTimeline({ run }: { run: RelocationRunView }) {
  const now = new Date();
  // Open the stage holding the current focus step; with no focus (done/failed
  // terminal states) open nothing and let the admin expand freely.
  const focusStage = run.stages.find((stage) =>
    stage.steps.some((step) => step.id === run.focusStepId),
  );
  return (
    <Accordion defaultValue={focusStage ? [focusStage.id] : []}>
      {run.stages.map((stage) => (
        <AccordionItem key={stage.id} value={stage.id}>
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {stage.id}
              </span>
              {stage.label.he}
              <span className="text-xs text-muted-foreground">
                ({stage.steps.filter((s) => s.status === 'done').length}/{stage.steps.length})
              </span>
            </span>
          </AccordionTrigger>
          <AccordionPanel>
            {stage.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין צעדים בשלב זה.</p>
            ) : (
              <ul className="mt-1">
                {stage.steps.map((step) => (
                  <StepRow key={step.id} step={step} now={now} />
                ))}
              </ul>
            )}
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function OpenItemsCard({ run }: { run: RelocationRunView }) {
  if (run.openItems.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>פריטים פתוחים</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {run.openItems.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <Badge variant={item.severity === 'warn' ? 'warning' : 'info'}>
                {item.severity === 'warn' ? 'דורש טיפול' : 'לידיעה'}
              </Badge>
              <span>{item.label.he}</span>
              {item.resolvedAt ? (
                <span className="text-xs text-muted-foreground">
                  טופל: {formatDateTime(item.resolvedAt)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function RollbacksCard({ run }: { run: RelocationRunView }) {
  if (run.rollbacks.length === 0) return null;
  const labelById = new Map(
    run.stages.flatMap((stage) => stage.steps.map((step) => [step.id, step.label.he] as const)),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>היסטוריית Rollback</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {run.rollbacks.map((entry, i) => (
            <li key={i} className="flex items-center gap-2">
              <Undo2 className="size-4 text-muted-foreground" aria-hidden />
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {entry.stepId}
              </span>
              <span>{labelById.get(entry.stepId) ?? entry.stepId}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
