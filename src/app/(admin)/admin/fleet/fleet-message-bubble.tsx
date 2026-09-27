import { Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message';
import { formatIsraelDate, formatIsraelTime } from '@/lib/date';
import {
  bubbleAuthor,
  isExpiredUnanswered,
  isWaitingOnOwner,
  preparedCommandOf,
  type BubbleEvent,
  type MessageEvent,
} from '@/lib/fleet/conversation';
import { KIND_LABEL, KIND_VARIANT } from '@/lib/fleet/labels';
import { ltrSegments } from '@/lib/fleet/ltr-segments';
import { cn } from '@/lib/utils';
import { FleetAuthorAvatar } from './fleet-agent-avatar';
import { AttachmentList } from './fleet-attachments';
import { ContinueButton, CopyCommandButton, PendingRequestActions } from './fleet-bubble-actions';

// One bubble (plan D3), a local wrapper over the shadcn `message` + `bubble`
// primitives. Decisions this file encodes:
//
// - Sides: the owner at the inline END (left in RTL), the agent at the START,
//   logical classes only (the primitives' data-[align=end] + self-end).
// - Fill: owner bg-muted, agent white + hairline border. NEVER the primitive's
//   `default` variant (bg-primary): DESIGN.md forbids indigo as a container
//   fill. No success/info tints either — status colour lives in chips/buttons.
// - Metadata (label · time · status) sits UNDER the bubble on the page
//   background, never inside bg-muted (#737373 on #f5f5f5 = 4.35:1, fails AA).
// - Content is never cut: titles and bodies wrap (wrap-anywhere), the
//   prepared command scrolls horizontally inside its own box. Only the list
//   preview is truncated.

const TAIL = { owner: 'rounded-ee-sm', agent: 'rounded-es-sm' } as const;

export function FleetText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('whitespace-pre-wrap wrap-anywhere', className)}>
      {ltrSegments(text).map((seg, i) =>
        seg.type === 'text' ? (
          seg.value
        ) : seg.type === 'code' ? (
          <code key={i} dir="ltr" className="rounded-sm bg-foreground/5 px-1 font-mono text-[0.85em]">
            {seg.value}
          </code>
        ) : (
          <bdi key={i} dir="ltr">
            {seg.value}
          </bdi>
        ),
      )}
    </p>
  );
}

function hoursLeft(expiresAt: string, nowMs: number): number {
  return (Date.parse(expiresAt) - nowMs) / 3_600_000;
}

function PreparedCommand({ command, open }: { command: string; open: boolean }) {
  const block = (
    <div className="relative">
      <pre
        dir="ltr"
        className="overflow-x-auto rounded-md bg-foreground/5 p-3 pe-10 text-xs leading-relaxed whitespace-pre"
      >
        <code>{command}</code>
      </pre>
      <div className="absolute top-1 end-1">
        <CopyCommandButton value={command} />
      </div>
    </div>
  );
  // In an open approval the command IS what is being approved — always shown.
  // In history it folds away.
  if (open) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium">הפקודה לאישור:</p>
        {block}
      </div>
    );
  }
  return (
    <details className="group/cmd">
      <summary className="cursor-pointer text-xs font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        הפקודה המוכנה
      </summary>
      <div className="mt-1">{block}</div>
    </details>
  );
}

function MessageBody({ event, nowMs }: { event: MessageEvent; nowMs: number }) {
  const { row } = event;
  const isAgent = event.author === 'agent';
  const pending = row.status === 'pending';
  const command = preparedCommandOf(row);
  const left = pending ? hoursLeft(row.expires_at, nowMs) : null;
  const expiringSoon = left !== null && left > 0 && left < 24;
  const titleId = `title-${row.id}`;

  return (
    <div className="space-y-2">
      {isAgent ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={KIND_VARIANT[row.kind] ?? 'neutral'}>{KIND_LABEL[row.kind] ?? row.kind}</Badge>
          {row.tier === 2 ? <Badge variant="destructive">רגיש</Badge> : null}
          {expiringSoon ? (
            <Badge variant="warning">
              {Math.ceil(left) <= 1 ? 'פג בעוד פחות משעה' : `פג בעוד ${Math.ceil(left)} שעות`}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {event.replyToTitle ? (
        <p className="text-xs text-foreground/80">
          בתגובה ל: <bdi dir="auto">{event.replyToTitle}</bdi>
        </p>
      ) : null}
      <h3 id={titleId} dir="auto" className="text-sm font-semibold wrap-anywhere">
        {row.title}
      </h3>
      {row.body ? <FleetText text={row.body} /> : null}
      {command ? <PreparedCommand command={command} open={pending && row.kind === 'approval'} /> : null}
      <AttachmentList payload={row.payload} />
      {isAgent && pending ? (
        <PendingRequestActions id={row.id} kind={row.kind} title={row.title} titleId={titleId} />
      ) : null}
    </div>
  );
}

function statusOf(event: BubbleEvent, ownerEta: string | null): { text: string; tone?: 'warning' } | null {
  if (event.type === 'verdict') return { text: event.consumed ? 'נקלט אצל הסוכן' : 'נשלח' };
  if (event.type === 'completion') return null;
  const { row } = event;
  if (event.author === 'agent') {
    if (row.status === 'pending') return { text: 'ממתין לתשובתך', tone: 'warning' };
    if (isExpiredUnanswered(row)) {
      return row.kind === 'approval'
        ? { text: 'פג תוקף — הסוכן יגיש מחדש אם עדיין רלוונטי' }
        : { text: `פג ללא מענה · ${formatIsraelDate(row.expires_at)}` };
    }
    return null;
  }
  // The owner's own message. There is no "read" state for these — inbox
  // items are never acked — so no double tick (plan D6).
  if (row.status === 'pending') return { text: ownerEta ? `נשלח · ${ownerEta}` : 'נשלח' };
  if (row.status === 'completed') return { text: 'בוצע' };
  if (row.status === 'expired') return { text: 'לא נקלט, פג תוקף' };
  if (row.answered_at) return { text: 'ענית בעצמך' };
  return null;
}

function VerdictBody({ event }: { event: Extract<BubbleEvent, { type: 'verdict' }> }) {
  const head =
    event.verdict === 'approved' ? (
      <span className="flex items-center gap-1.5 font-semibold">
        <Check className="size-4" aria-hidden />
        אישרת
      </span>
    ) : event.verdict === 'denied' ? (
      <span className="flex items-center gap-1.5 font-semibold">
        <X className="size-4" aria-hidden />
        דחית
      </span>
    ) : null;
  return (
    <div className="space-y-1">
      {head}
      {event.text ? <FleetText text={event.text} /> : head ? null : <p>השבת</p>}
      <p className="text-xs text-foreground/80">
        על: <bdi dir="auto">{event.row.title}</bdi>
      </p>
    </div>
  );
}

function CompletionBody({ event }: { event: Extract<BubbleEvent, { type: 'completion' }> }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 font-semibold">
        <Check className="size-4" aria-hidden />
        בוצע
      </p>
      <FleetText text={event.text} />
      <p className="text-xs text-muted-foreground">
        על: <bdi dir="auto">{event.row.title}</bdi>
      </p>
    </div>
  );
}

export function FleetMessageBubble({
  event,
  role,
  showLabel,
  showAvatar,
  nowMs,
  ownerEta,
  dimmed,
}: {
  event: BubbleEvent;
  role: string;
  /** First bubble of a group: visible author label + avatar. */
  showLabel: boolean;
  showAvatar: boolean;
  nowMs: number;
  /** Delivery ETA under the owner's LAST pending message only. */
  ownerEta: string | null;
  /** Expired without an answer: the whole bubble fades (floor opacity-60 ≈ 5:1). */
  dimmed: boolean;
}) {
  const author = bubbleAuthor(event);
  const isOwner = author === 'owner';
  const label = isOwner ? 'אני' : role;
  const time = formatIsraelTime(event.at);
  const status = statusOf(event, ownerEta);
  const isMessage = event.type === 'message';
  const row = event.row;
  const canContinue =
    isMessage && row.status !== 'pending' && !(row.status === 'expired');
  const waitingOwner = isMessage && isWaitingOnOwner(row);

  return (
    <Message align={isOwner ? 'end' : 'start'}>
      {/* Top-aligned with the first bubble; cancel the primitive's lift for
          messages that have a footer (ours always do). */}
      <MessageAvatar className="self-start bg-transparent group-has-data-[slot=message-footer]/message:translate-y-0">
        {showAvatar ? (
          <FleetAuthorAvatar author={author} role={role} size="sm" />
        ) : (
          <span className="block size-6" aria-hidden />
        )}
      </MessageAvatar>
      <MessageContent className="gap-1">
        <article
          // Anchor for ?focus=<requestId> and for the pending bar: only the
          // message event carries the row id (a row can have 3 bubbles).
          id={isMessage ? `msg-${row.id}` : undefined}
          tabIndex={isMessage ? -1 : undefined}
          data-waiting-owner={waitingOwner ? 'true' : undefined}
          aria-label={`${isOwner ? 'אני' : role}, ${time}`}
          className={cn(
            'flex w-full min-w-0 flex-col rounded-xl outline-none focus:ring-3 focus:ring-ring/50',
            isOwner ? 'items-end' : 'items-start',
          )}
        >
          <Bubble
            variant={isOwner ? 'muted' : 'outline'}
            align={isOwner ? 'end' : 'start'}
            className={cn('max-w-[85%] md:max-w-prose', dimmed && 'opacity-60')}
          >
            {/* Fill comes from the explicit variant: `muted` (owner) or
                `outline` = white + hairline border (agent). */}
            <BubbleContent className={cn('w-full wrap-anywhere text-foreground', TAIL[author])}>
              {event.type === 'message' ? (
                <MessageBody event={event} nowMs={nowMs} />
              ) : event.type === 'verdict' ? (
                <VerdictBody event={event} />
              ) : (
                <CompletionBody event={event} />
              )}
            </BubbleContent>
          </Bubble>
          <MessageFooter className="flex-wrap gap-x-1.5 gap-y-0.5 px-1">
            <span className={showLabel ? undefined : 'sr-only'}>{label}</span>
            {showLabel ? <span aria-hidden>·</span> : null}
            <time dateTime={event.at}>{time}</time>
            {status ? (
              <>
                <span aria-hidden>·</span>
                <span className={status.tone === 'warning' ? 'text-warning' : undefined}>{status.text}</span>
              </>
            ) : null}
            {canContinue ? (
              <>
                <span aria-hidden>·</span>
                <ContinueButton id={row.id} title={row.title} />
              </>
            ) : null}
          </MessageFooter>
        </article>
      </MessageContent>
    </Message>
  );
}
