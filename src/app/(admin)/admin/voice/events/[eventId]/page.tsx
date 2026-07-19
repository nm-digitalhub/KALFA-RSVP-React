import Link from 'next/link';

import { formatIsraelDate } from '@/lib/date';
import { getEventForAdminView } from '@/lib/data/admin/campaigns';
import { listCallAttemptsForEvent } from '@/lib/data/admin/voice-ops';
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
  EmptyState,
  formatDateTime,
  PageHeading,
  Pagination,
  parsePageParam,
} from '../../../_components';
import { callStatusLabel, callStatusVariant } from '../../_helpers';

export const metadata = { title: 'שיחות AI לאירוע' };

const sectionClass = 'space-y-3 rounded-lg border border-border bg-card p-5';

export default async function EventVoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { eventId } = await params;
  const sp = await searchParams;
  const page = parsePageParam(sp.page);

  const [event, attempts] = await Promise.all([
    getEventForAdminView(eventId),
    listCallAttemptsForEvent(eventId, { page }),
  ]);

  // Aggregate the page's rows for the stat tiles (full-history counts would need
  // a separate query; the visible page's tallies are shown as "בעמוד זה").
  const rows = attempts.items;
  const tally = {
    completed: rows.filter((r) => r.status === 'completed').length,
    noAnswer: rows.filter((r) => r.status === 'no_answer').length,
    failed: rows.filter((r) => ['failed', 'failed_to_start', 'no_response'].includes(r.status))
      .length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    confirmed: rows.filter((r) => r.rsvpDigit === '1').length,
    declined: rows.filter((r) => r.rsvpDigit === '2').length,
  };

  const tiles = [
    { label: 'ניסיונות (סה״כ)', value: String(attempts.total) },
    { label: 'הושלמו (בעמוד)', value: String(tally.completed) },
    { label: 'אין מענה (בעמוד)', value: String(tally.noAnswer) },
    { label: 'נכשלו (בעמוד)', value: String(tally.failed) },
    { label: 'בוטלו (בעמוד)', value: String(tally.cancelled) },
    { label: 'אישרו (בעמוד)', value: String(tally.confirmed) },
    { label: 'סירבו (בעמוד)', value: String(tally.declined) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>שיחות AI — {event.name}</PageHeading>
        <Link href="/admin/voice" className="text-sm font-medium text-primary hover:underline">
          ← חזרה למוקד
        </Link>
      </div>

      <section className={sectionClass}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">תאריך האירוע</dt>
            <dd>{event.event_date ? formatIsraelDate(event.event_date) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סטטוס אירוע</dt>
            <dd>{event.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">סוג אירוע</dt>
            <dd>{event.event_type ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-1 rounded-lg border border-border p-4">
            <span className="text-sm text-muted-foreground">{t.label}</span>
            <span className="text-2xl font-bold">{t.value}</span>
          </div>
        ))}
      </div>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">ניסיונות שיחה</h2>
        {rows.length === 0 ? (
          <EmptyState>אין ניסיונות שיחה לאירוע זה.</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>זמן</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>משך (שנ׳)</TableHead>
                    <TableHead>תוצאת RSVP</TableHead>
                    <TableHead>סיבת סיום</TableHead>
                    <TableHead>הקלטה</TableHead>
                    <TableHead>תמליל</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell dir="ltr" className="whitespace-nowrap">
                        {formatDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={callStatusVariant(r.status)}>
                          {callStatusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.durationSec ?? '—'}</TableCell>
                      <TableCell>
                        {r.rsvpDigit === '1'
                          ? `אישר${r.rsvpMethod ? ` (${r.rsvpMethod})` : ''}`
                          : r.rsvpDigit === '2'
                            ? 'סירב'
                            : '—'}
                      </TableCell>
                      <TableCell>{r.finishReason ?? '—'}</TableCell>
                      <TableCell>
                        {r.hasRecording && r.sessionHistoryId ? (
                          <Link
                            href={`/admin/recordings?session=${r.sessionHistoryId}`}
                            className="text-sm text-primary hover:underline"
                          >
                            צפייה
                          </Link>
                        ) : r.hasRecording ? (
                          // Recording exists on the row but no session id to
                          // build the recordings link (early Branch B rows).
                          <span className="text-sm text-muted-foreground">קיימת (ללא session)</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{r.hasTranscript ? 'קיים' : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath={`/admin/voice/events/${eventId}`}
              page={attempts.page}
              pageSize={attempts.pageSize}
              total={attempts.total}
            />
          </>
        )}
      </section>
    </div>
  );
}
