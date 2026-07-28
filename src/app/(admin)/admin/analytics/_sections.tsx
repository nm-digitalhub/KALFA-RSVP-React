import { ArrowDown, ArrowUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge, EmptyState, formatDateTime } from '../_components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  FunnelStep,
  Ga4ConfigIssue,
  QuotaSnapshot,
  RealtimeResult,
  SectionState,
  Sectioned,
} from '@/lib/analytics/ga4-types';

// Building blocks for /admin/analytics, composed from the shadcn primitives
// (Card / Alert / Progress / Table / Badge) — nothing hand-rolled that a
// primitive already provides. All data arrives as props from the DAL; state
// handling follows the stats-page precedent: one failing section never takes
// down the page, and every state renders inside the same footprint.

export function SectionCard({
  title,
  section,
  children,
}: {
  title: string;
  section: Sectioned<unknown>;
  children: React.ReactNode;
}) {
  const { state, fetchedAt } = section;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <SectionBadge state={state} fetchedAt={fetchedAt} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'error' ? (
          <p className="text-sm text-muted-foreground">
            לא ניתן היה לטעון את הנתונים כרגע. נסו לרענן.
          </p>
        ) : state === 'quota_exhausted' ? (
          <p className="text-sm text-muted-foreground">
            חריגה זמנית ממכסת הקריאות של Google Analytics — הנתונים יחזרו להתעדכן בהמשך.
          </p>
        ) : state === 'not_configured' ? (
          <p className="text-sm text-muted-foreground">האנליטיקס אינו מוגדר.</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function SectionBadge({ state, fetchedAt }: { state: SectionState; fetchedAt: string | null }) {
  if (state === 'error') return <Badge variant="destructive">שגיאה בטעינה</Badge>;
  if (state === 'quota_exhausted') return <Badge variant="warning">מכסה מוצתה</Badge>;
  if (state === 'stale' && fetchedAt) {
    return <Badge variant="secondary">נתונים מ-{formatDateTime(fetchedAt)}</Badge>;
  }
  return null;
}

// KPI tile — LOCAL to this dashboard (single consumer; deliberately not a
// shared admin abstraction). Card-based per the shadcn-first directive.
export function StatTile({
  label,
  value,
  icon: Icon,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  extra?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 p-4">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
      {extra}
    </Card>
  );
}

// KPI delta vs the equal previous period (v3). Renders nothing when there is
// no previous row, and 'חדש' when the previous value was 0 (a % of zero is
// meaningless). Directional color only accompanies the arrow + number — never
// color alone.
export function StatDelta({
  current,
  previous,
}: {
  current: number;
  previous: number | null | undefined;
}) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    return current > 0 ? (
      <span className="text-xs text-muted-foreground">חדש בתקופה זו</span>
    ) : null;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return <span className="text-xs text-muted-foreground">ללא שינוי מהתקופה הקודמת</span>;
  }
  const up = pct > 0;
  return (
    <span
      className={`flex items-center gap-1 text-xs tabular-nums ${up ? 'text-success' : 'text-destructive'}`}
    >
      {up ? (
        <ArrowUp className="size-3" aria-hidden />
      ) : (
        <ArrowDown className="size-3" aria-hidden />
      )}
      <span dir="ltr">
        {up ? '+' : '-'}
        {Math.abs(pct)}%
      </span>
      מהתקופה הקודמת
    </span>
  );
}

// Rows carry an explicit stable key from the data (pagePath, countryId,
// eventName…) — never an array index.
export interface DataRow {
  key: string;
  cells: (string | number)[];
}

export function DataTable({
  headers,
  rows,
  emptyText,
}: {
  headers: string[];
  rows: DataRow[];
  emptyText: string;
}) {
  if (rows.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              {row.cells.map((cell, j) => (
                <TableCell key={j} className={j > 0 ? 'tabular-nums' : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Engagement meter on the shadcn Progress primitive. Clamped + NaN-guarded:
// any non-finite input renders as 0, never a runtime error.
export function EngagementMeter({ rate }: { rate: number | null }) {
  if (rate === null) return null;
  const pct = Number.isFinite(rate) ? Math.min(100, Math.max(0, Math.round(rate * 100))) : 0;
  return <Progress value={pct} aria-label={`${pct}% מעורבות`} />;
}

export function RealtimeCard({ realtime }: { realtime: RealtimeResult }) {
  const { section, quota } = realtime;
  // The realtime token pool is separate from core; its remaining budget shows
  // here (its own consumer), not in the page-level core banner.
  const hourRemaining = quota?.tokensPerHour?.remaining;
  return (
    <SectionCard title="פעילות עכשיו" section={section}>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums">
          {section.data?.activeUsersNow ?? 0}
        </span>
        <Badge variant="info">בזמן אמת</Badge>
      </div>
      {section.data && section.data.topEvents.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {section.data.topEvents.map((e) => (
            <li key={e.eventName} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{e.eventName}</span>
              <span className="tabular-nums">{e.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {section.data && section.data.topLocations.length > 0 ? (
        <ul className="space-y-1 border-t border-border pt-2 text-sm">
          {section.data.topLocations.map((l) => (
            <li key={l.label} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="tabular-nums">{l.activeUsers}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {typeof hourRemaining === 'number' ? (
        <p className="text-xs text-muted-foreground">
          מכסת זמן-אמת: נותרו {hourRemaining.toLocaleString('he-IL')} יחידות לשעה זו.
        </p>
      ) : null}
    </SectionCard>
  );
}

// v3 funnel: the phase-1 journey in order. Progress bars are relative to the
// widest step (not step #1 — leads can legitimately exceed signups), so the
// bar always fits; the between-steps percentage reads vs the PREVIOUS step
// and only when that step has data.
export function FunnelCard({ section }: { section: Sectioned<FunnelStep[]> }) {
  const steps = section.data ?? [];
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <SectionCard title="משפך עסקי" section={section}>
      <ul className="space-y-3">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].count : 0;
          const pctOfPrev = i > 0 && prev > 0 ? Math.round((step.count / prev) * 100) : null;
          return (
            <li key={step.name} className="space-y-1">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>{step.label}</span>
                <span className="tabular-nums">
                  {step.count.toLocaleString('he-IL')}
                  {pctOfPrev !== null ? (
                    <span className="text-xs text-muted-foreground"> ({pctOfPrev}% מהשלב הקודם)</span>
                  ) : null}
                </span>
              </div>
              <Progress
                value={Math.min(100, Math.round((step.count / max) * 100))}
                aria-label={`${step.label}: ${step.count}`}
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        ספירת אירועים בטווח הנבחר; השלבים אינם מסלול חובה — הפרשים בין שלבים הם אינדיקציה, לא
        נטישה מדויקת.
      </p>
    </SectionCard>
  );
}

// Quota alert (core pool). Rendered ONLY on quota_exhausted (page-level
// check); remaining values print only when the API actually reported them —
// partial/missing metadata can never throw here.
export function QuotaBanner({ quota }: { quota: QuotaSnapshot | null }) {
  const hourRemaining = quota?.tokensPerHour?.remaining;
  const dayRemaining = quota?.tokensPerDay?.remaining;
  return (
    <Alert>
      <AlertTitle>חריגה ממכסת Google Analytics</AlertTitle>
      <AlertDescription>
        הנתונים יחזרו להתעדכן בהמשך.
        {typeof hourRemaining === 'number' && typeof dayRemaining === 'number'
          ? ` נותרו ${hourRemaining.toLocaleString('he-IL')} יחידות לשעה זו ו-${dayRemaining.toLocaleString('he-IL')} להיום.`
          : null}
      </AlertDescription>
    </Alert>
  );
}

// Safe "not configured" alert: issue code → generic Hebrew line. Never a
// path, never a value (getInfraConfigStatus precedent).
const CONFIG_ISSUE_TEXT: Record<Ga4ConfigIssue, string> = {
  missing_property_id: 'מזהה הנכס (GA4_PROPERTY_ID) אינו מוגדר בסביבת השרת.',
  invalid_property_id: 'מזהה הנכס המוגדר אינו תקין — נדרש מזהה מספרי.',
  missing_credentials_path: 'נתיב קובץ האישורים (GOOGLE_APPLICATION_CREDENTIALS) אינו מוגדר.',
  credentials_unreadable: 'קובץ האישורים אינו קיים או אינו קריא לשרת.',
};

export function NotConfiguredCard({ issue }: { issue: Ga4ConfigIssue | null }) {
  return (
    <Alert>
      <AlertTitle>חיבור Google Analytics אינו מוגדר</AlertTitle>
      <AlertDescription>
        {issue ? CONFIG_ISSUE_TEXT[issue] : 'תצורת החיבור חסרה.'}
      </AlertDescription>
    </Alert>
  );
}
