import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';

import {
  getFleetConversation,
  getFleetGoalById,
  getFleetRequestRole,
  parseConversationCursor,
  readFleetRoles,
} from '@/lib/data/admin/fleet';
import {
  buildConversationEvents,
  isWaitingOnOwner,
  layoutStream,
} from '@/lib/fleet/conversation';
import { requestBodyAuthor } from '@/lib/fleet/content-author';
import { reachability } from '@/lib/fleet/reachability';
import { firstParam } from '../_components';
import { ConversationScroller, FocusHeadingOnPhone } from './conversation-scroller';
import { FleetAgentAvatar } from './fleet-agent-avatar';
import { ComposerProvider, FleetComposer, PendingBar } from './fleet-composer';
import { GoalStrip } from './fleet-goals';
import { FleetStream } from './fleet-stream';

const BASE_PATH = '/admin/fleet';
const ROLE_RE = /^[a-z0-9][a-z0-9-]*$/;

function conversationHref(role: string, extra: Record<string, string> = {}): string {
  return `${BASE_PATH}?${new URLSearchParams({ role, ...extra }).toString()}`;
}

// One conversation (?role=), anchored on a message (?focus=). Old links keep
// landing on their message:
//   /admin/fleet/<id>          → [id]/page.tsx → ?focus=<id>
//   ?id=<id>&type=request      → ?focus=<id>
//   ?id=<id>&type=goal         → ?role=<goal.role>
//   ?focus=<id> (no role)      → ?role=<its role>&focus=<id>
// Authorization: every read below goes through requirePlatformPermission
// ('manage_settings') in the data layer, plus RLS.
export default async function AdminFleetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const role = firstParam(sp.role);
  const focus = firstParam(sp.focus);
  const legacyId = firstParam(sp.id);

  if (legacyId) {
    if (firstParam(sp.type) === 'goal') {
      const goal = z.uuid().safeParse(legacyId).success ? await getFleetGoalById(legacyId) : null;
      if (goal) redirect(conversationHref(goal.role));
      return <NoConversation notice="המטרה לא נמצאה — ייתכן שהקישור ישן." />;
    }
    redirect(`${BASE_PATH}?${new URLSearchParams({ focus: legacyId }).toString()}`);
  }

  if (!role) {
    if (focus) {
      const owner = await getFleetRequestRole(focus);
      if (owner) redirect(conversationHref(owner, { focus }));
      return <NoConversation notice="ההודעה לא נמצאה — ייתכן שהקישור ישן." />;
    }
    return <NoConversation />;
  }

  if (!ROLE_RE.test(role)) return <RoleNotFound />;

  const cursor = parseConversationCursor(firstParam(sp.before), firstParam(sp.after));
  const [roles, conversation] = await Promise.all([
    readFleetRoles(),
    getFleetConversation(role, { cursor, focus }),
  ]);
  const roleInfo = roles?.find((r) => r.name === role);
  if (!roleInfo && conversation.rows.length === 0 && conversation.goals.length === 0) {
    return <RoleNotFound />;
  }

  const reach = reachability(roleInfo, 'owner_direct_request');
  const goalReach = reachability(roleInfo, 'goal_due');
  const events = buildConversationEvents(conversation.rows, conversation.goals, {
    rootTitles: new Map(Object.entries(conversation.rootTitles)),
    handoffsOut: conversation.handoffsOut,
    windowStart: conversation.windowStart,
  });
  const items = layoutStream(events, conversation.generatedAt);
  const waitingCount = conversation.rows.filter(isWaitingOnOwner).length;
  const lastOwnerPending =
    conversation.rows.findLast((r) => r.status === 'pending' && requestBodyAuthor(r.payload) === 'owner') ?? null;
  const hasClosedExchange = conversation.rows.some((r) => r.status !== 'pending' && r.status !== 'expired');
  const isEmpty = events.length === 0;
  const headingId = 'fleet-conversation-heading';

  return (
    <ComposerProvider role={role}>
      <div className="flex h-[calc(100dvh-var(--admin-header-h)-4rem)] flex-col overflow-hidden rounded-xl border border-border bg-background md:h-full">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5">
          <Link
            href={BASE_PATH}
            aria-label="חזרה לרשימת השיחות"
            className="inline-flex size-11 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
          >
            <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
          </Link>
          <FleetAgentAvatar role={role} />
          <div className="min-w-0">
            <h2 id={headingId} tabIndex={-1} className="font-semibold outline-none">
              <bdi dir="ltr" className="wrap-anywhere">
                {role}
              </bdi>
            </h2>
            <p className={reach.tone === 'blocked' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {reach.status}
            </p>
          </div>
        </header>
        <FocusHeadingOnPhone headingId={headingId} role={role} />

        <GoalStrip goals={conversation.goals} />

        {conversation.focusFound === false ? (
          <p role="status" className="shrink-0 border-b border-border bg-muted px-4 py-2 text-sm">
            ההודעה לא נמצאה — ייתכן שהקישור ישן.
          </p>
        ) : null}

        <ConversationScroller
          focusId={conversation.focusFound ? (focus ?? null) : null}
          edge={cursor.kind === 'after' ? 'top' : 'bottom'}
          version={`${events.length}:${events.at(-1)?.key ?? ''}`}
        >
          {conversation.olderCursor ? (
            <Link
              href={conversationHref(role, { before: conversation.olderCursor })}
              className="mx-auto rounded-4xl border border-border px-3 py-1.5 text-sm text-primary hover:bg-muted"
            >
              טען הודעות קודמות
            </Link>
          ) : null}
          {isEmpty ? (
            <p className="my-auto py-10 text-center text-sm text-muted-foreground">
              אין עדיין הודעות עם <bdi dir="ltr">{role}</bdi>
            </p>
          ) : (
            <FleetStream
              items={items}
              role={role}
              nowMs={conversation.generatedAt}
              lastOwnerPendingId={lastOwnerPending?.id ?? null}
              ownerEta={reach.eta}
            />
          )}
          {conversation.newerCursor ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                href={conversationHref(role, { after: conversation.newerCursor })}
                className="rounded-4xl border border-border px-3 py-1.5 text-sm text-primary hover:bg-muted"
              >
                טען הודעות חדשות
              </Link>
              <Link
                href={conversationHref(role)}
                className="rounded-4xl border border-border px-3 py-1.5 text-sm text-primary hover:bg-muted"
              >
                להודעות האחרונות
              </Link>
            </div>
          ) : null}
        </ConversationScroller>

        <PendingBar count={waitingCount} />
        <FleetComposer
          reach={reach}
          goalReach={goalReach}
          hasClosedExchange={hasClosedExchange}
          autoFocus={isEmpty}
        />
      </div>
    </ComposerProvider>
  );
}

function NoConversation({ notice }: { notice?: string }) {
  return (
    <div className="flex flex-col gap-3 md:h-full">
      {notice ? (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <div className="hidden flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground md:flex">
        בחרו סוכן מהרשימה כדי לפתוח את השיחה איתו
      </div>
    </div>
  );
}

function RoleNotFound() {
  return (
    <div className="space-y-3 rounded-xl border border-border p-8 text-center">
      <p className="font-semibold">הסוכן לא נמצא</p>
      <Link href={BASE_PATH} className="text-sm text-primary hover:underline">
        חזרה לרשימת השיחות
      </Link>
    </div>
  );
}
