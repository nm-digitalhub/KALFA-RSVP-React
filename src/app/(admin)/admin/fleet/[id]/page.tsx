import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessageSquareWarning } from 'lucide-react';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getFleetRequest,
  listFleetRequestsByRole,
  listFleetRoles,
} from '@/lib/data/admin/fleet';
import { LocalDateTime } from '@/components/local-date-time';
import { EmptyState, PageHeading } from '../../_components';
import {
  KIND_LABEL,
  KIND_VARIANT,
  PendingRequestCard,
  ReplyToRequestForm,
} from '../fleet-client';

export const metadata: Metadata = { title: 'פרטי סוכן' };

// Admin: single fleet-request detail (/admin/fleet/[id]) — the full body and
// payload, a lifecycle timeline (created → answered → consumed-by-agent), and
// the same role's other requests so follow-ups on the same topic are visible
// as a thread. A pending request renders the same answer card as the inbox.

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתינה למענה',
  approved: 'אושר',
  denied: 'נדחה',
  answered: 'נענה',
  expired: 'פג תוקף',
  consumed: 'נקלט אצל הסוכן',
  completed: 'הושלם',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  approved: 'success',
  denied: 'destructive',
  answered: 'info',
  expired: 'neutral',
  consumed: 'success',
  completed: 'success',
};

// Attachments an agent referenced in payload.attachments — files it saved under
// .fleet-logs/drafts/, served through the admin-gated /api/admin/fleet-file
// route (realpath-allowlisted there; a bad/outside path simply 404s). Audio gets
// an inline player so the owner can ear-check drafts straight from this page.
type RequestAttachment = { path: string; label?: string; mime?: string };

function parseAttachments(payload: unknown): RequestAttachment[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return [];
  const raw = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): RequestAttachment[] => {
    if (!item || typeof item !== 'object') return [];
    const { path, label, mime } = item as Record<string, unknown>;
    if (typeof path !== 'string' || !path.trim()) return [];
    return [
      {
        path,
        label: typeof label === 'string' ? label : undefined,
        mime: typeof mime === 'string' ? mime : undefined,
      },
    ];
  });
}

// The id every message in this conversation shares (see fleet_owner_request's
// migration comment). A request that is itself already a reply carries it in
// payload.thread_root; a request that started the conversation has none yet —
// replying to IT for the first time roots the thread at its own id.
function threadRootOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const value = (payload as { thread_root?: unknown }).thread_root;
  return typeof value === 'string' ? value : null;
}

function attachmentKind(
  att: RequestAttachment,
): 'audio' | 'image' | 'video' | 'file' {
  const hint = att.mime ?? '';
  if (hint.startsWith('audio/')) return 'audio';
  if (hint.startsWith('image/')) return 'image';
  if (hint.startsWith('video/')) return 'video';
  const ext = att.path.toLowerCase().split('.').pop() ?? '';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  return 'file';
}

function AttachmentItem({ att }: { att: RequestAttachment }) {
  const src = `/api/admin/fleet-file?path=${encodeURIComponent(att.path)}`;
  const name = att.label ?? (att.path.split('/').pop() || att.path);
  const kind = attachmentKind(att);
  return (
    <li className="space-y-1 rounded-md border border-border p-3">
      <p className="wrap-anywhere text-sm font-medium">{name}</p>
      {kind === 'audio' ? (
        <audio controls preload="none" src={src} className="w-full" />
      ) : kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- authed dynamic stream, not an optimizable static asset
        <img src={src} alt={name} className="max-h-72 max-w-full rounded-md" />
      ) : kind === 'video' ? (
        <video
          controls
          preload="none"
          src={src}
          className="max-h-72 w-full rounded-md"
        />
      ) : (
        <a href={src} download className="text-sm text-primary hover:underline">
          הורדת הקובץ
        </a>
      )}
      <p className="wrap-anywhere text-xs text-muted-foreground" dir="ltr">
        {att.path}
      </p>
    </li>
  );
}

function TimelineItem({
  title,
  at,
  detail,
}: {
  title: string;
  at: string | null;
  detail?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 border-s-2 border-border ps-4 pb-4 last:pb-0">
      <span className="text-sm font-medium">{title}</span>
      {at ? (
        <span className="text-xs text-muted-foreground">
          <LocalDateTime iso={at} />
        </span>
      ) : null}
      {detail}
    </li>
  );
}

export default async function AdminFleetRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Non-UUID path segments 404 cleanly instead of erroring in the DB layer.
  if (!z.uuid().safeParse(id).success) notFound();

  const [found, roles] = await Promise.all([
    getFleetRequest(id),
    listFleetRoles(),
  ]);
  if (!found) notFound();
  const { request, answeredByName } = found;
  const threadRoot = threadRootOf(request.payload) ?? request.id;
  const related = await listFleetRequestsByRole(
    request.role,
    request.id,
    threadRoot,
  );
  // The request this page is about might already be resolved while a
  // DIFFERENT message in the same conversation is still waiting on the
  // owner — invisible before this fix (see fleet-consistency-audit.md §1),
  // and exactly the shape of the "answered but never closed" bug found and
  // fixed elsewhere in the fleet tonight. Only flag an OTHER item — this
  // request's own pending state already gets the full PendingRequestCard.
  const pendingThreadItem =
    request.status === 'pending'
      ? null
      : (related.sameThread.find((item) => item.status === 'pending') ?? null);

  const preparedCommand =
    request.payload &&
    typeof request.payload === 'object' &&
    !Array.isArray(request.payload) &&
    typeof (request.payload as { prepared_command?: unknown })
      .prepared_command === 'string'
      ? (request.payload as { prepared_command: string }).prepared_command
      : null;
  const attachments = parseAttachments(request.payload);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <PageHeading className="wrap-anywhere">{request.title}</PageHeading>
        <Badge variant={STATUS_VARIANT[request.status] ?? 'neutral'}>
          {STATUS_LABEL[request.status] ?? request.status}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/fleet" className="text-primary hover:underline">
          ← חזרה לכל הפניות
        </Link>
      </p>

      {pendingThreadItem ? (
        <Alert>
          <MessageSquareWarning />
          <AlertTitle>הודעה אחרת באותה שיחה עדיין ממתינה לתשובתך</AlertTitle>
          <AlertDescription>
            הפנייה הזו נסגרה, אבל{' '}
            <Link
              href={`/admin/fleet/${pendingThreadItem.id}`}
              className="font-medium text-primary hover:underline"
            >
              &quot;{pendingThreadItem.title}&quot;
            </Link>{' '}
            באותה שיחה עדיין ממתינה למענה.
          </AlertDescription>
        </Alert>
      ) : null}

      {request.status === 'pending' ? (
        <PendingRequestCard request={request} linkToDetail={false} />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{request.role}</Badge>
              <Badge variant={KIND_VARIANT[request.kind] ?? 'secondary'}>
                {KIND_LABEL[request.kind] ?? request.kind}
              </Badge>
              {request.run_id ? (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  run: {request.run_id}
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* wrap-anywhere: long unbreakable agent tokens must not inflate
                the shell's flex row (see fleet-client.tsx PendingRequestCard). */}
            <p className="wrap-anywhere whitespace-pre-wrap text-sm">
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
          </CardContent>
        </Card>
      )}

      {attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>קבצים מצורפים</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {attachments.map((att) => (
                <AttachmentItem key={att.path} att={att} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>ציר זמן</CardTitle>
        </CardHeader>
        <CardContent>
          <ol>
            <TimelineItem title="הפנייה הוגשה" at={request.created_at} />
            {request.answered_at ? (
              <TimelineItem
                title={`נענתה${answeredByName ? ` על-ידי ${answeredByName}` : ''}`}
                at={request.answered_at}
                detail={
                  request.answer ? (
                    <p className="wrap-anywhere whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                      {request.answer}
                    </p>
                  ) : undefined
                }
              />
            ) : null}
            {request.status === 'expired' ? (
              <TimelineItem title="פגה ללא מענה" at={request.expires_at} />
            ) : null}
            {request.consumed_at ? (
              <TimelineItem
                title="הסוכן קלט את התשובה"
                at={request.consumed_at}
              />
            ) : request.answered_at ? (
              <TimelineItem
                title="ממתין לקליטה אצל הסוכן"
                at={null}
                detail={
                  <p className="text-xs text-muted-foreground">
                    הסוכן קולט תשובות בתחילת הריצה הבאה שלו.
                  </p>
                }
              />
            ) : null}
          </ol>
        </CardContent>
      </Card>

      {request.status !== 'pending' ? (
        <Card>
          <CardHeader>
            <CardTitle>המשך שיחה עם {request.role}</CardTitle>
            <CardDescription>
              נשלח כפנייה חדשה, מקושרת לשיחה הזו — הסוכן יראה את הפנייה והתשובה
              המקוריות כהקשר לפני שהוא פועל.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReplyToRequestForm
              role={request.role}
              tier={request.tier}
              threadRoot={threadRoot}
              roles={roles}
            />
          </CardContent>
        </Card>
      ) : null}

      {related.sameThread.length > 0 ? (
        <Card className="ring-info/30 bg-info/5">
          <CardHeader>
            <CardTitle>שאר ההודעות באותה שיחה</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {related.sameThread.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <Badge variant={STATUS_VARIANT[item.status] ?? 'neutral'}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                  <Link
                    href={`/admin/fleet/${item.id}`}
                    className="wrap-anywhere text-sm text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="ms-auto text-xs text-muted-foreground">
                    <LocalDateTime iso={item.created_at} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>פעילות אחרת מ-{request.role}</CardTitle>
        </CardHeader>
        <CardContent>
          {related.other.length === 0 ? (
            <EmptyState>אין פעילות נוספת מהתפקיד הזה</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {related.other.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <Badge variant={STATUS_VARIANT[item.status] ?? 'neutral'}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                  <Link
                    href={`/admin/fleet/${item.id}`}
                    className="wrap-anywhere text-sm text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="ms-auto text-xs text-muted-foreground">
                    <LocalDateTime iso={item.created_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
