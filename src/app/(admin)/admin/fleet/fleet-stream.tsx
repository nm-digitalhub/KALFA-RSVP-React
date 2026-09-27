import Link from 'next/link';

import { MessageGroup } from '@/components/ui/message';
import { formatIsraelDate } from '@/lib/date';
import {
  isExpiredUnanswered,
  type BubbleEvent,
  type StreamItem,
  type SystemEvent,
} from '@/lib/fleet/conversation';
import { cn } from '@/lib/utils';
import { FleetMessageBubble } from './fleet-message-bubble';

// The read side of a conversation: day separators, bubble groups, centred
// system lines and folded runs of expired requests (plan D3, D8, D10).
// Server-rendered; the only client islands are inside the bubbles.

function conversationHref(role: string, focus?: string): string {
  const qs = new URLSearchParams({ role });
  if (focus) qs.set('focus', focus);
  return `/admin/fleet?${qs.toString()}`;
}

const SYSTEM_TONE: Record<SystemEvent['tone'], string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
};

function SystemLine({ event }: { event: SystemEvent }) {
  return (
    <div className="mx-auto max-w-prose px-2 text-center text-xs">
      <p className={cn('wrap-anywhere', SYSTEM_TONE[event.tone])}>
        {event.text}
        {event.link ? (
          <>
            {' · '}
            <Link
              href={conversationHref(event.link.role, event.link.focus)}
              className="font-medium text-primary hover:underline"
            >
              {event.link.label}
              <span aria-hidden> ▸</span>
            </Link>
          </>
        ) : null}
      </p>
      {event.detail ? (
        <details className="mt-1 text-start">
          <summary className="cursor-pointer text-center font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            סיכום
          </summary>
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-foreground">{event.detail}</p>
        </details>
      ) : null}
    </div>
  );
}

function Group({
  events,
  role,
  nowMs,
  lastOwnerPendingId,
  ownerEta,
}: {
  events: BubbleEvent[];
  role: string;
  nowMs: number;
  lastOwnerPendingId: string | null;
  ownerEta: string;
}) {
  return (
    <MessageGroup>
      {events.map((e, i) => (
        <FleetMessageBubble
          key={e.key}
          event={e}
          role={role}
          showLabel={i === 0}
          showAvatar={i === 0}
          nowMs={nowMs}
          ownerEta={e.type === 'message' && e.row.id === lastOwnerPendingId ? ownerEta : null}
          dimmed={e.type === 'message' && isExpiredUnanswered(e.row)}
        />
      ))}
    </MessageGroup>
  );
}

export function FleetStream({
  items,
  role,
  nowMs,
  lastOwnerPendingId,
  ownerEta,
}: {
  items: StreamItem[];
  role: string;
  nowMs: number;
  lastOwnerPendingId: string | null;
  ownerEta: string;
}) {
  return (
    <>
      {items.map((item) => {
        switch (item.type) {
          case 'day':
            return (
              <div key={item.key} className="flex items-center gap-3 py-1" role="presentation">
                <span className="h-px flex-1 bg-border" />
                <h3 className="text-xs font-medium text-muted-foreground">{item.label}</h3>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          case 'system':
            return <SystemLine key={item.key} event={item.event} />;
          case 'expired-run': {
            const first = item.events[0].row;
            const last = item.events[item.events.length - 1].row;
            return (
              <details key={item.key} className="group/expired">
                <summary className="mx-auto w-fit cursor-pointer rounded-4xl border border-border px-3 py-1 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
                  {item.events.length} פניות פגו ללא מענה
                  {' · '}
                  {formatIsraelDate(first.created_at) === formatIsraelDate(last.created_at)
                    ? formatIsraelDate(first.created_at)
                    : `${formatIsraelDate(first.created_at)}–${formatIsraelDate(last.created_at)}`}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {item.events.map((e) => (
                    <FleetMessageBubble
                      key={e.key}
                      event={e}
                      role={role}
                      showLabel
                      showAvatar
                      nowMs={nowMs}
                      ownerEta={null}
                      dimmed
                    />
                  ))}
                </div>
              </details>
            );
          }
          case 'group':
            return (
              <Group
                key={item.key}
                events={item.events}
                role={role}
                nowMs={nowMs}
                lastOwnerPendingId={lastOwnerPendingId}
                ownerEta={ownerEta}
              />
            );
        }
      })}
    </>
  );
}
