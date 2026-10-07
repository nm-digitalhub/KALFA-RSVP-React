import { ChevronLeft, Terminal } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getRdpAccessRequestDetail, type RdpOwnerDetail } from '@/lib/data/admin/rdp-access-owner';
import { formatIsraelTime, formatIsraelTimeSeconds } from '@/lib/date';
import { describeEventLine, ENDED_REASON_TEXT, minutesLabel, OWNER_STATUS_LABEL } from '@/lib/rdp-access/copy';
import { stationStatesFor, type RdpDisplayStatus } from '@/lib/rdp-access/status';

import { AccessTrack } from '../../access-track';
import { Badge, type BadgeVariant } from '../../../_components';

export const metadata = { title: 'פרטי בקשת גישה' };
export const dynamic = 'force-dynamic';

// One request, read-only: where it stands on the track, the facts, and the audit timeline in the order it happened.
// Owner-only (the gate is inside the data call). Nothing here changes anything: deciding, denying and revoking
// happen in the server terminal, and the foot of the page gives the command.

const STATUS_BADGE: Record<RdpDisplayStatus, BadgeVariant> = {
  pending: 'warning',
  active: 'success',
  ended: 'neutral',
  denied: 'destructive',
  expired: 'neutral',
  cancelled: 'neutral',
};

const idSchema = z.uuid();

function stationHints(d: RdpOwnerDetail): readonly [string, string, string, string] {
  const approval =
    d.status === 'pending' ? 'ממתין להחלטה' : d.answeredAt ? formatIsraelTime(d.answeredAt) : OWNER_STATUS_LABEL[d.status];
  const file = d.grant ? `הורד ${d.grant.filesIssued} מתוך ${d.grant.maxFiles}` : 'לא הורד';
  // the fourth station is what the gateway recorded, not what the grant implies
  const end = d.connectedAt
    ? `השער אישר חיבור ב-${formatIsraelTime(d.connectedAt)}`
    : d.grant?.endedAt
      ? `לא נרשם חיבור · ${d.grant.endedReason ? (ENDED_REASON_TEXT[d.grant.endedReason] ?? OWNER_STATUS_LABEL[d.status]) : OWNER_STATUS_LABEL[d.status]} ${formatIsraelTime(d.grant.endedAt)}`
      : d.grant
        ? 'עוד לא נרשם חיבור'
        : OWNER_STATUS_LABEL[d.status];
  return [formatIsraelTime(d.createdAt), approval, file, end];
}

function cutText(d: RdpOwnerDetail): string {
  if (!d.grant) return '—';
  if (d.grant.tunnelsCutAt) return `אושר פעמיים, ${formatIsraelTime(d.grant.tunnelsCutAt)}`;
  if (d.grant.endedAt) return d.grant.cutAttempts > 0 ? `עוד לא אושר (${d.grant.cutAttempts} ניסיונות)` : 'עוד לא נוסה';
  return 'הגישה עוד פעילה';
}

export default async function RdpRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const detail = await getRdpAccessRequestDetail(parsed.data);
  if (!detail) notFound();

  const id8 = detail.id.slice(0, 8);
  const approvedLine =
    detail.grantedMinutes !== null
      ? detail.grantedMinutes === detail.requestedMinutes
        ? minutesLabel(detail.grantedMinutes)
        : `ביקש ${minutesLabel(detail.requestedMinutes)}, אושרו ${minutesLabel(detail.grantedMinutes)}`
      : minutesLabel(detail.requestedMinutes);

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="נתיב" className="flex items-center gap-2 text-sm text-foreground/70">
        <Link href="/admin/rdp-access/requests" className="text-primary underline-offset-4 hover:underline">
          כל הבקשות
        </Link>
        <ChevronLeft className="size-4" aria-hidden />
        <code dir="ltr" className="font-mono">
          {id8}
        </code>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">
          בקשה{' '}
          <code dir="ltr" className="font-mono">
            {id8}
          </code>
        </h1>
        <Badge variant={STATUS_BADGE[detail.status]}>{OWNER_STATUS_LABEL[detail.status]}</Badge>
      </div>

      <AccessTrack states={stationStatesFor(detail.status, { filesIssued: detail.grant?.filesIssued ?? 0, connected: detail.connectedAt !== null })} hints={stationHints(detail)} />

      <section aria-labelledby="rdp-detail-facts" className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/30 p-5 sm:p-6">
        <h2 id="rdp-detail-facts" className="text-lg font-bold">
          פרטים
        </h2>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          <Fact label="מטרה" wide>
            {detail.reason}
          </Fact>
          <Fact label="מבקש">{detail.requesterName ?? '—'}</Fact>
          <Fact label="כתובת הבקשה">
            <code dir="ltr" className="font-mono">
              {detail.requestIp ?? '—'}
            </code>
          </Fact>
          <Fact label="משך">{approvedLine}</Fact>
          <Fact label="יעד" wide>
            <code dir="ltr" className="font-mono">
              {detail.grant?.target ?? '—'}
            </code>
          </Fact>
          <Fact label="ניתוק החיבורים החיים">{cutText(detail)}</Fact>
          <Fact label="הערת הבעלים">{detail.answerNote ?? '—'}</Fact>
        </dl>
      </section>

      <section aria-labelledby="rdp-detail-events" className="flex flex-col gap-3">
        <h2 id="rdp-detail-events" className="text-lg font-bold">
          יומן אירועים
        </h2>
        {detail.events.length === 0 ? (
          <p className="text-sm text-foreground/70">עוד לא נרשמו אירועים.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-border rounded-2xl border border-border p-0">
            {detail.events.map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <time dateTime={event.at} dir="ltr" className="font-mono text-[13px] text-foreground/70 tabular-nums">
                  {formatIsraelTimeSeconds(event.at)}
                </time>
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-foreground/70 uppercase">
                  {event.kind.replaceAll('_', ' ')}
                </code>
                <span className="text-[15px]">{describeEventLine(event.kind, event.outcome)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80">
        <Terminal className="size-4" aria-hidden />
        <span>אישור, דחייה וביטול נעשים רק בטרמינל של השרת</span>
        <code dir="ltr" className="font-mono text-[13px]">
          npm run rdp:access -- show {id8}
        </code>
      </p>
    </div>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[14px] border border-border bg-background px-4 py-3 ${wide ? 'col-span-full' : ''}`}>
      <dt className="text-[13px] leading-5 text-foreground/70">{label}</dt>
      <dd className="m-0 text-[15px] leading-6 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
