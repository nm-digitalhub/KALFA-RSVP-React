import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getConsoleCallRecording, listConsoleCalls } from '@/lib/data/admin/console-history';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Badge,
  type BadgeVariant,
  EmptyState,
  firstParam,
  formatDateTime,
  PageHeading,
  Pagination,
  parsePageParam,
} from '../../_components';

export const metadata = { title: 'היסטוריית מוקד' };

// Plan stage 8 — admin history for the browser call-center (console_calls):
// manual outbound, inbound-customer, and linked ai_handoff rows. Distinct from
// /admin/recordings (which lists call_attempts — the AI outreach ledger) and
// from /admin/voice/events/[eventId] (per-event AI call supervision): this is
// the console's OWN call log, gated on manage_voice like every other console
// route. Recording links render ONLY for a viewer who also holds
// view_recordings — the same owner-only gate the AI recordings page enforces,
// re-applied here because these calls carry live guest voice too.

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'נכנסת',
  outbound: 'יוצאת',
  internal: 'פנימית',
};
const KIND_LABEL: Record<string, string> = {
  manual: 'חיוג ידני',
  inbound_customer: 'נכנסת מלקוח',
  internal: 'פנימית',
  ai_handoff: 'העברה מה-AI',
};
const STATUS_LABEL: Record<string, string> = {
  initiated: 'התחילה',
  ringing: 'מצלצלת',
  connected: 'מחוברת',
  ended: 'הסתיימה',
  missed: 'לא נענתה',
  failed: 'נכשלה',
  no_agent: 'אין נציג',
};
/**
 * Why a call ended, in Hebrew.
 *
 * ended_reason has been read from the database by this page's loader all along and
 * never rendered — so the column that says WHICH kind of failure this was existed
 * and was invisible. It matters more since 17.8, when the scenario started folding
 * the platform's own SIP code into it (486 busy, 480 unavailable, 404 invalid
 * number, 603 rejected, 408 no answer, 402 no funds), because the status badge
 * cannot express those: 'failed' is one word for six different events.
 *
 * The stored value is `reason` or `reason:detail`. The DETAIL is looked up first —
 * it is the network's own account of what happened, and "תפוס" tells an operator
 * more than "רגל הנציג נכשלה".
 *
 * An unmapped value renders as NOTHING rather than raw. `caller_hangup:sip_503` is
 * for a bug report, not for a Hebrew admin table, and showing it would put
 * engineering vocabulary in front of whoever is reviewing the call floor. The value
 * is still in the row for anyone who queries it.
 */
const END_DETAIL_LABEL: Record<string, string> = {
  busy: 'תפוס',
  unavailable: 'לא זמין',
  invalid_number: 'מספר לא תקין',
  rejected: 'נדחתה',
  no_answer: 'לא ענה',
  no_funds: 'אין יתרה',
};
const END_REASON_LABEL: Record<string, string> = {
  no_agent: 'לא נמצא נציג פנוי',
  caller_hangup: 'המתקשר ניתק',
  operator_hangup: 'הנציג סיים',
  operator_failed: 'רגל הנציג נכשלה',
  callee_failed: 'היעד לא נענה',
  guest_failed: 'האורח לא נענה',
  call_end: 'נותקה מהמוקד',
  safety_net_timeout: 'נותקה בזמן קצוב',
  session_terminating: 'הסתיימה עם הסשן',
};

function endedReasonLabel(raw: string | null): string | null {
  if (!raw) return null;
  const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : null;
  if (detail && END_DETAIL_LABEL[detail]) return END_DETAIL_LABEL[detail];
  const base = raw.includes(':') ? raw.slice(0, raw.indexOf(':')) : raw;
  return END_REASON_LABEL[base] ?? null;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  initiated: 'info',
  ringing: 'info',
  connected: 'success',
  ended: 'neutral',
  missed: 'warning',
  failed: 'destructive',
  no_agent: 'warning',
};

function formatDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function ConsoleHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; direction?: string; status?: string }>;
}) {
  await requirePlatformPermission('manage_voice');
  const sp = await searchParams;
  const page = parsePageParam(sp.page);
  const direction = firstParam(sp.direction) as 'inbound' | 'outbound' | 'internal' | undefined;
  const status = firstParam(sp.status);

  const [result, canViewRecordings] = await Promise.all([
    listConsoleCalls({ page, direction, status }),
    hasPlatformPermission('view_recordings'),
  ]);

  // Recording URLs are fetched (and each fetch audited — getConsoleCallRecording
  // itself calls recordStaffAccess) ONLY for this page's rows, and only when the
  // viewer holds view_recordings — never pre-fetched for a viewer who cannot see
  // them. recordStaffAccess fails CLOSED by throwing (by design — an unaudited
  // read must not proceed), so each row is caught individually: one row's audit
  // or lookup failure must degrade that row's link to "unavailable", never 500
  // the whole history page.
  const recordingUrls = new Map<string, string>();
  if (canViewRecordings) {
    await Promise.all(
      result.items
        .filter((r) => r.hasRecording)
        .map(async (r) => {
          try {
            const url = await getConsoleCallRecording(r.id);
            if (url) recordingUrls.set(r.id, url);
          } catch {
            // Degrade this row only — see the comment above.
          }
        }),
    );
  }

  const basePath = '/admin/voice/console-history';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <PageHeading>היסטוריית מוקד</PageHeading>
        <p className="text-sm text-muted-foreground">
          שיחות יוצאות ידניות, נכנסות מלקוחות, והעברות מהסוכן הקולי — נציגי הפלטפורמה בלבד.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {(['inbound', 'outbound', 'internal'] as const).map((d) => (
          <a
            key={d}
            href={`${basePath}?direction=${d}${status ? `&status=${status}` : ''}`}
            className={direction === d ? 'font-semibold text-primary' : 'text-muted-foreground hover:underline'}
          >
            {DIRECTION_LABEL[d]}
          </a>
        ))}
        {direction ? (
          <a href={`${basePath}${status ? `?status=${status}` : ''}`} className="text-muted-foreground hover:underline">
            הצג הכל
          </a>
        ) : null}
      </div>

      {result.items.length === 0 ? (
        <EmptyState>אין עדיין שיחות מוקד.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>מועד</TableHead>
                  <TableHead>כיוון</TableHead>
                  <TableHead>סוג</TableHead>
                  <TableHead>מצב</TableHead>
                  <TableHead>מספר (מוסתר)</TableHead>
                  <TableHead>אירוע</TableHead>
                  <TableHead>נציג</TableHead>
                  <TableHead>הועברה אל</TableHead>
                  <TableHead>משך</TableHead>
                  <TableHead>הקלטה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell dir="ltr" className="whitespace-nowrap">
                      {formatDateTime(r.startedAt)}
                    </TableCell>
                    <TableCell>{DIRECTION_LABEL[r.direction] ?? r.direction}</TableCell>
                    <TableCell>{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                      {endedReasonLabel(r.endedReason) ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {endedReasonLabel(r.endedReason)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell dir="ltr">{r.callerMasked ?? '—'}</TableCell>
                    <TableCell>
                      {r.eventId ? (
                        <a
                          href={`/admin/voice/events/${r.eventId}`}
                          className="text-primary underline underline-offset-2"
                        >
                          {r.eventName ?? '—'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{r.agentName ?? '—'}</TableCell>
                    <TableCell>{r.transferredToAgentName ?? '—'}</TableCell>
                    <TableCell>{formatDuration(r.durationSec)}</TableCell>
                    <TableCell>
                      {!r.hasRecording ? (
                        '—'
                      ) : !canViewRecordings ? (
                        <span className="text-muted-foreground">קיימת</span>
                      ) : recordingUrls.has(r.id) ? (
                        <a
                          href={recordingUrls.get(r.id)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                        >
                          האזנה
                        </a>
                      ) : (
                        <span className="text-muted-foreground">לא זמינה</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            basePath={basePath}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            queryParams={{ direction, status }}
          />
        </>
      )}
    </div>
  );
}
