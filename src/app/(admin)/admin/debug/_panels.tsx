import Link from 'next/link';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress, type ProgressVariant } from '@/components/ui/progress';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LocalDateTime } from '@/components/local-date-time';

import type { SoftResult, ProcessesProbe, SystemProbe, DeployProbe, HttpProbe } from '@/lib/ops/agent-client';
import type { JobHealthRow, DbHealthRow, QUEUE_EXPECTED_MAX_MINUTES } from '@/lib/ops/db-health';
import type { RecentError } from '@/lib/ops/app-health';
import type { IntegrationStatus } from '@/lib/ops/integrations';
import type { ExchangeConnectionView } from '@/lib/data/exchange-connections';
import {
  isQueueStale,
  severityForThreshold,
  severityForSwapUsage,
  severityForSwapActivity,
  worseSeverity,
  DISK_WARN_PCT,
  DISK_ERROR_PCT,
  CONNECTIONS_WARN_RATIO,
  CONNECTIONS_ERROR_RATIO,
  type OverallStatus,
  type Severity,
} from '@/lib/ops/summary';

// Presentational only — every panel here receives ALREADY-RESOLVED data
// (fetched with Promise.allSettled in page.tsx) so a failed source renders an
// Alert instead of throwing and taking the whole page down with it.

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '—';
}

function UnavailableAlert({ reason }: { reason: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>הנתונים אינם זמינים</AlertTitle>
      <AlertDescription>{reason}</AlertDescription>
    </Alert>
  );
}

// --- Summary card ------------------------------------------------------

const LEVEL_VARIANT: Record<OverallStatus['level'], BadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  error: 'destructive',
};
const LEVEL_LABEL: Record<OverallStatus['level'], string> = {
  ok: 'תקין',
  warn: 'דורש תשומת לב',
  error: 'תקלה',
};
const PROGRESS_VARIANT: Record<Severity, ProgressVariant> = {
  ok: 'success',
  warn: 'warning',
  error: 'destructive',
};

// Only rendered for warn/error — a healthy metric stays visually quiet
// instead of stamping every card with a "תקין" badge.
function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === 'ok') return null;
  return <Badge variant={LEVEL_VARIANT[severity]}>{LEVEL_LABEL[severity]}</Badge>;
}

export function SummaryCard({ status }: { status: OverallStatus }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Badge variant={LEVEL_VARIANT[status.level]}>{LEVEL_LABEL[status.level]}</Badge>
          <CardTitle>מצב כללי</CardTitle>
        </div>
      </CardHeader>
      {status.reasons.length > 0 && (
        <CardContent>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {status.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

// --- Deploy & Build ------------------------------------------------------

export function DeployPanel({ result }: { result: SoftResult<DeployProbe> | null }) {
  if (!result) return <UnavailableAlert reason="לא ניתן להתחבר לסוכן הבדיקות (kalfa-ops-agent)" />;
  if (!result.ok) return <UnavailableAlert reason={result.reason} />;
  const d = result.data;
  const aligned = d.gitHead != null && d.gitHead === d.gitOriginMain && d.ahead === 0 && d.behind === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>פריסה ובנייה</CardTitle>
        <CardDescription>.deploy-id ↔ BUILD_ID ↔ git HEAD מול origin/main</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">deploy-id</div>
            <div className="font-mono">{d.deployId ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">BUILD_ID</div>
            <div className="font-mono">{d.buildId ?? '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">git HEAD</div>
            <div className="font-mono">{shortSha(d.gitHead)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">origin/main</div>
            <div className="font-mono">{shortSha(d.gitOriginMain)}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={aligned ? 'success' : 'warning'}>{aligned ? 'מיושר' : 'לא מיושר'}</Badge>
          {d.ahead != null && d.behind != null && (d.ahead > 0 || d.behind > 0) && (
            <span className="text-muted-foreground">
              {d.ahead} לפנים · {d.behind} מאחור (מול origin/main מקומי — ללא fetch אוטומטי)
            </span>
          )}
          {d.dirtyFiles > 0 && <Badge variant="neutral">{d.dirtyFiles} קבצים לא-מחויבים</Badge>}
          {d.localMigrationsCount != null && (
            <span className="text-muted-foreground">{d.localMigrationsCount} קבצי מיגרציה מקומיים</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Processes & System ---------------------------------------------------

const PM2_STATUS_VARIANT: Record<string, BadgeVariant> = {
  online: 'success',
  stopped: 'destructive',
  errored: 'destructive',
  stopping: 'warning',
  launching: 'warning',
};

function ProcessesTable({ data }: { data: ProcessesProbe }) {
  return (
    <div className="space-y-2">
      {(data.undeclared.length > 0 || data.missing.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {data.undeclared.map((name) => (
            <Badge key={name} variant="warning">
              רץ ולא מוצהר: {name}
            </Badge>
          ))}
          {data.missing.map((name) => (
            <Badge key={name} variant="destructive">
              מוצהר ולא רץ: {name}
            </Badge>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>תהליך</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>הפעלות מחדש</TableHead>
              <TableHead>זיכרון</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>פעיל</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.pm2.map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  <Badge variant={PM2_STATUS_VARIANT[p.status] ?? 'neutral'}>{p.status}</Badge>
                </TableCell>
                <TableCell>
                  {p.restarts}
                  {p.unstable > 0 && <span className="text-destructive"> ({p.unstable} לא-יציב)</span>}
                </TableCell>
                <TableCell>{p.memMB != null ? `${p.memMB} MB` : '—'}</TableCell>
                <TableCell>{p.cpu != null ? `${p.cpu}%` : '—'}</TableCell>
                <TableCell>
                  {p.uptimeSec != null ? `${Math.round(p.uptimeSec / 60)} דק'` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SystemSummary({ data }: { data: SystemProbe }) {
  const diskPct = data.disk?.pct ?? null;
  const diskSeverity = diskPct != null ? severityForThreshold(diskPct, DISK_WARN_PCT, DISK_ERROR_PCT) : 'ok';

  const swapPct = data.mem?.swapPct ?? null;
  const swapUsageSeverity = swapPct != null ? severityForSwapUsage(swapPct) : 'ok';
  const swapActivitySeverity = data.swapActivity
    ? severityForSwapActivity(data.swapActivity.pswpinPerSec, data.swapActivity.pswpoutPerSec)
    : 'ok';
  const swapSeverity = worseSeverity(swapUsageSeverity, swapActivitySeverity);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            דיסק
            <SeverityBadge severity={diskSeverity} />
          </span>
          <span className="text-muted-foreground" dir="ltr">
            {data.disk ? `${data.disk.usedGB}GB / ${data.disk.sizeGB}GB (${data.disk.availGB}GB פנוי)` : '—'}
          </span>
        </div>
        {diskPct != null && <Progress value={diskPct} variant={PROGRESS_VARIANT[diskSeverity]} />}
        <div className="flex flex-wrap gap-3 pt-2 text-xs text-muted-foreground">
          <span>.fleet-logs/drafts: {formatBytes(data.logsDirBytes.fleetDrafts)}</span>
          <span>לוגי PM2: {formatBytes(data.logsDirBytes.pm2Logs)}</span>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span>זיכרון</span>
          <span className="text-muted-foreground" dir="ltr">
            {data.mem
              ? `${((data.mem.totalMB! - data.mem.availMB!) / 1024).toFixed(1)}GB / ${(data.mem.totalMB! / 1024).toFixed(1)}GB`
              : '—'}
          </span>
        </div>
        {data.mem?.pct != null && <Progress value={data.mem.pct} />}
        <div className="flex flex-wrap gap-3 pt-2 text-xs text-muted-foreground">
          <span>
            Load: <bdi dir="ltr">{data.load.map((n) => n.toFixed(2)).join(' · ')}</bdi>
          </span>
        </div>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            Swap
            <SeverityBadge severity={swapSeverity} />
          </span>
          <span className="text-muted-foreground" dir="ltr">
            {data.mem?.swapUsedMB != null
              ? `${(data.mem.swapUsedMB / 1024).toFixed(1)}GB / ${data.mem.swapTotalMB != null ? (data.mem.swapTotalMB / 1024).toFixed(1) : '—'}GB`
              : '—'}
          </span>
        </div>
        {swapPct != null && <Progress value={swapPct} variant={PROGRESS_VARIANT[swapUsageSeverity]} />}
        <div className="text-xs text-muted-foreground">
          {data.swapActivity ? (
            <>
              פעילות (מרווח {data.swapActivity.sampledAt}):{' '}
              <bdi dir="ltr">
                {data.swapActivity.pswpinPerSec.toFixed(1)} in / {data.swapActivity.pswpoutPerSec.toFixed(1)} out
                עמודים/שנ&apos;
              </bdi>
              {swapActivitySeverity === 'ok' && swapUsageSeverity !== 'ok' && ' — שימוש גבוה אך ללא פעילות פעילה כרגע'}
            </>
          ) : (
            'נתוני פעילות swap (sysstat) אינם זמינים'
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs sm:col-span-2">
        <Badge variant={data.puppeteerCache.chrome ? 'success' : 'destructive'}>
          Chromium cache: {data.puppeteerCache.chrome ? 'קיים' : 'חסר'}
        </Badge>
        <Badge variant="neutral">Node {data.nodeVersion}</Badge>
        <Badge variant="neutral">{Math.round(data.uptimeSec / 3600)} שעות uptime</Badge>
      </div>
    </div>
  );
}

function HttpRow({ label, result }: { label: string; result: HttpProbe['origin'] }) {
  const ok = result.code != null && result.code < 400;
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <Badge variant={ok ? 'success' : 'destructive'}>{result.code ?? 'אין תגובה'}</Badge>
        <span className="text-muted-foreground">{result.ms}ms</span>
      </span>
    </div>
  );
}

export function ProcessesPanel({
  processes,
  system,
  http,
}: {
  processes: SoftResult<ProcessesProbe> | null;
  system: SoftResult<SystemProbe> | null;
  http: SoftResult<HttpProbe> | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>תהליכים ומערכת</CardTitle>
        <CardDescription>PM2 מוצהר-מול-רץ · דיסק וזיכרון · בדיקת HTTP מקומי מול קצה ציבורי</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {processes ? (
          processes.ok ? <ProcessesTable data={processes.data} /> : <UnavailableAlert reason={processes.reason} />
        ) : (
          <UnavailableAlert reason="לא ניתן להתחבר לסוכן הבדיקות (kalfa-ops-agent)" />
        )}
        {system && (system.ok ? <SystemSummary data={system.data} /> : <UnavailableAlert reason={system.reason} />)}
        {http && http.ok && (
          <div className="grid gap-2 sm:grid-cols-2">
            <HttpRow label="שרת מקומי (127.0.0.1:3002)" result={http.data.origin} />
            <HttpRow label="קצה ציבורי (beta.kalfa.me)" result={http.data.edge} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Database --------------------------------------------------------------

export function DatabasePanel({ result, reason }: { result: DbHealthRow | null; reason: string | null }) {
  if (!result) return <UnavailableAlert reason={reason ?? 'שגיאה לא ידועה'} />;
  const connRatio = result.maxConnections > 0 ? result.activeConnections / result.maxConnections : null;
  const connPct = connRatio != null ? Math.round(connRatio * 100) : null;
  const connSeverity = connRatio != null ? severityForThreshold(connRatio, CONNECTIONS_WARN_RATIO, CONNECTIONS_ERROR_RATIO) : 'ok';

  return (
    <Card>
      <CardHeader>
        <CardTitle>מסד הנתונים</CardTitle>
        <CardDescription>חיבורים · יחסי cache-hit · שאילתות איטיות</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              חיבורים
              <SeverityBadge severity={connSeverity} />
            </div>
            <div className="text-lg font-medium" dir="ltr">
              {result.activeConnections} / {result.maxConnections}
            </div>
            {connPct != null && <Progress value={connPct} variant={PROGRESS_VARIANT[connSeverity]} />}
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Index hit rate</div>
            <div className="text-lg font-medium">
              {result.indexHitRatePct != null ? `${result.indexHitRatePct.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Table hit rate</div>
            <div className="text-lg font-medium">
              {result.tableHitRatePct != null ? `${result.tableHitRatePct.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">שאילתה פעילה הכי ארוכה: </span>
          {result.longestQuerySeconds != null ? `${Math.round(result.longestQuerySeconds)} שנ'` : 'אין שאילתה פעילה'}
        </div>
        {result.topQueries.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שאילתה</TableHead>
                  <TableHead>קריאות</TableHead>
                  <TableHead>ממוצע (ms)</TableHead>
                  <TableHead>סה&quot;כ (ms)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.topQueries.map((q, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs sm:max-w-md" title={q.query}>
                      {q.query}
                    </TableCell>
                    <TableCell>{q.calls}</TableCell>
                    <TableCell>{q.meanExecTimeMs}</TableCell>
                    <TableCell>{q.totalExecTimeMs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Jobs & Worker -----------------------------------------------------

function JobRow({ row, expectedMaxMinutes }: { row: JobHealthRow; expectedMaxMinutes?: number }) {
  const isStale = isQueueStale(row, expectedMaxMinutes);

  return (
    <TableRow>
      <TableCell className="font-medium">{row.queueName}</TableCell>
      <TableCell>
        {row.isScheduled ? (
          <span className="font-mono text-xs" dir="ltr">
            {row.cron} {row.scheduleTz && row.scheduleTz !== 'UTC' ? `(${row.scheduleTz})` : ''}
          </span>
        ) : (
          <Badge variant="neutral">אירוע-מונע</Badge>
        )}
      </TableCell>
      <TableCell>{row.queuedCount + row.activeCount}</TableCell>
      <TableCell>{row.failedCount > 0 ? <span className="text-destructive">{row.failedCount}</span> : 0}</TableCell>
      <TableCell>{row.lastCompletedOn ? <LocalDateTime iso={row.lastCompletedOn} /> : '—'}</TableCell>
      <TableCell>
        {row.isScheduled ? (
          <Badge variant={isStale ? 'destructive' : 'success'}>{isStale ? 'ללא הרצה בזמן' : 'תקין'}</Badge>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  );
}

export function JobsPanel({
  jobHealth,
  reason,
  expectedMinutes,
  webhookUnprocessed,
}: {
  jobHealth: JobHealthRow[] | null;
  reason: string | null;
  expectedMinutes: typeof QUEUE_EXPECTED_MAX_MINUTES;
  webhookUnprocessed: number | null;
}) {
  if (!jobHealth) return <UnavailableAlert reason={reason ?? 'שגיאה לא ידועה'} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>תורים ו-Worker</CardTitle>
        <CardDescription>
          מצב תורי pg-boss בזמן אמת · heartbeat של ה-worker נגזר מ-outreach-arm (רץ כל דקה)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {webhookUnprocessed != null && webhookUnprocessed > 0 && (
          <Alert variant="destructive">
            <AlertTitle>webhooks ממתינים</AlertTitle>
            <AlertDescription>
              {webhookUnprocessed} רשומות ב-webhook_inbox טרם עובדו — ראו /admin/webhooks
            </AlertDescription>
          </Alert>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>תור</TableHead>
                <TableHead>תזמון</TableHead>
                <TableHead>בהמתנה/פעיל</TableHead>
                <TableHead>נכשלו</TableHead>
                <TableHead>הרצה אחרונה</TableHead>
                <TableHead>מצב</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobHealth.map((row) => (
                <JobRow key={row.queueName} row={row} expectedMaxMinutes={expectedMinutes[row.queueName]} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Integrations --------------------------------------------------------

export function IntegrationsPanel({
  items,
  reason,
}: {
  items: IntegrationStatus[] | null;
  reason: string | null;
}) {
  if (!items) return <UnavailableAlert reason={reason ?? 'שגיאה לא ידועה'} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>אינטגרציות</CardTitle>
        <CardDescription>מצב מאוחסן בלבד — ללא קריאות live לספקים בטעינת הדף</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ספק</TableHead>
                <TableHead>מוגדר</TableHead>
                <TableHead>בדיקה אחרונה</TableHead>
                <TableHead>הערה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell>
                    <Badge variant={item.configured ? 'success' : 'neutral'}>
                      {item.configured ? 'מוגדר' : 'לא מוגדר'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.lastCheckedAt ? (
                      <LocalDateTime iso={item.lastCheckedAt} />
                    ) : item.healthCheckAvailable ? (
                      '—'
                    ) : (
                      <span className="text-muted-foreground">אין בדיקת בריאות זמינה</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Exchange (IONOS EWS) --------------------------------------------------

const EXCHANGE_STATUS_VARIANT: Record<ExchangeConnectionView['status'], BadgeVariant> = {
  verified: 'success',
  pending: 'warning',
  failed: 'destructive',
  revoked: 'neutral',
};
const EXCHANGE_STATUS_LABEL: Record<ExchangeConnectionView['status'], string> = {
  verified: 'מאומת',
  pending: 'ממתין',
  failed: 'נכשל',
  revoked: 'בוטל',
};

export function ExchangePanel({
  connections,
  reason,
}: {
  connections: ExchangeConnectionView[] | null;
  reason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange (IONOS EWS)</CardTitle>
        <CardDescription>
          כל חיבורי ה-Exchange בפלטפורמה, קריאה בלבד — ניהול ובדיקת חיבור ב-
          <Link href="/admin/settings" className="underline underline-offset-2">
            הגדרות
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!connections ? (
          <UnavailableAlert reason={reason ?? 'שגיאה לא ידועה'} />
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין חיבורי Exchange מוגדרים.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תיבת דואר</TableHead>
                  <TableHead>שיטת אימות</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>אימות אחרון</TableHead>
                  <TableHead>שגיאה אחרונה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {c.mailboxEmail}
                    </TableCell>
                    <TableCell>{c.authMethod.toUpperCase()}</TableCell>
                    <TableCell>
                      <Badge variant={EXCHANGE_STATUS_VARIANT[c.status]}>
                        {EXCHANGE_STATUS_LABEL[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{c.lastVerifiedAt ? <LocalDateTime iso={c.lastVerifiedAt} /> : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.lastError ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Alert>
          <AlertTitle>התנהגות ספק (IONOS) — נבדקה לעומק, לא דורשת פעולה</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              הסעיפים נחקרו ב-31.07 מול מקורות ראשוניים (תיעוד Microsoft EWS, מאגר הספרייה, ספריות EWS אחרות)
              ובחלקם אומתו חי מול השרת (Autodiscover מאומת, OAuth נבדק ונסגר) — הגישה הנוכחית אומתה כנכונה
              בכל אחד מהם.
            </p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                נקודת קצה: <span dir="ltr" className="font-mono">exchange.ionos.com/EWS/Exchange.asmx</span> — קבועה בקוד במכוון. Autodiscover מאומת חי (בקשה מאומתת אמיתית): מחזיר <span dir="ltr" className="font-mono">exchange2019.ionos.com</span> — hostname שונה, אך אותו שרת בדיוק (אותם IPs, אותו TLS cert)
              </li>
              <li>
                גרסת חיווט: <span dir="ltr" className="font-mono">Exchange2016</span> — מאומת גם על ידי ספריית EWS נפרדת לגמרי (Python) שנתקלת באותו כשל מדויק מול Exchange 2019
              </li>
              <li>
                <span dir="ltr" className="font-mono">GetUserAvailability</span> מחזירה 500 על תיבה זו — תקלה מתועדת ורחבה (לא ספציפית ל-IONOS, כולל ב-repo הרשמי של Microsoft); זמינות נגזרת מהיומן עצמו במקום, ונבדק שאין סיכון קריסה בנתיב הקוד שלנו
              </li>
              <li>
                ספריית <span dir="ltr" className="font-mono">ews-javascript-api@0.15.3</span> + <span dir="ltr" className="font-mono">@ewsjs/xhr@3.1.3</span> — ללא תחזוקה מאז 05/2024; תיקון ה-XML-escaping שביצענו כבר מכסה שני באגים פתוחים ב-upstream מאז 2020
              </li>
              <li>
                <span dir="ltr" className="font-mono">OAuth</span> נבדק ונסגר סופית: השרת תומך (Hybrid Modern Auth פעיל, אישר טוקן ריק כ-Bearer תקין-פורמטית), אך ל-<span dir="ltr" className="font-mono">kalfa.me</span> אין tenant ב-Entra ID כלל — אין דרך להנפיק טוקן תקף. NTLM נשאר שיטת האימות היחידה הזמינה
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// --- App errors (folded into the top of the page, not its own big panel) ---

export function AppErrorsPanel({
  counts,
  recent,
}: {
  counts: { last1h: number; last24h: number; last7d: number };
  recent: RecentError[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>שגיאות שרת</CardTitle>
        <CardDescription>ops_errors — נכתב לפני שערי ההתראה, ללא error.message (PII)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <span>שעה אחרונה: <strong>{counts.last1h}</strong></span>
          <span>24 שעות: <strong>{counts.last24h}</strong></span>
          <span>7 ימים: <strong>{counts.last7d}</strong></span>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין שגיאות מתועדות.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>זמן</TableHead>
                  <TableHead>נתיב</TableHead>
                  <TableHead>שגיאה</TableHead>
                  <TableHead>deploy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((err) => (
                  <TableRow key={err.id}>
                    <TableCell><LocalDateTime iso={err.occurred_at} /></TableCell>
                    <TableCell className="font-mono text-xs">
                      {err.method} {err.route_path ?? '—'}
                    </TableCell>
                    <TableCell>{err.error_name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{err.deploy_id ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
