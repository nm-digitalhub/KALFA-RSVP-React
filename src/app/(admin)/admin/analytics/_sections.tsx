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
  Ga4ConfigIssue,
  QuotaSnapshot,
  RealtimeSnapshot,
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

export function RealtimeCard({ realtime }: { realtime: Sectioned<RealtimeSnapshot> }) {
  return (
    <SectionCard title="פעילות עכשיו" section={realtime}>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums">
          {realtime.data?.activeUsersNow ?? 0}
        </span>
        <Badge variant="info">בזמן אמת</Badge>
      </div>
      {realtime.data && realtime.data.topEvents.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {realtime.data.topEvents.map((e) => (
            <li key={e.eventName} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{e.eventName}</span>
              <span className="tabular-nums">{e.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {realtime.data && realtime.data.topLocations.length > 0 ? (
        <ul className="space-y-1 border-t border-border pt-2 text-sm">
          {realtime.data.topLocations.map((l) => (
            <li key={l.label} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="tabular-nums">{l.activeUsers}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
