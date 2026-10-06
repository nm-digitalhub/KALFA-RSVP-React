'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Clock, Search, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { ConversationSummary } from '@/lib/fleet/conversation';
import { cn } from '@/lib/utils';
import { FleetAgentAvatar } from './fleet-agent-avatar';

// The conversation list (plan D2) — rendered by fleet/layout.tsx, which does
// not re-render on navigation (layout.md: "Layouts do not rerender on
// navigation, so they cannot access search params"). Everything that depends
// on the URL — the selected row, the phone list↔conversation split — reads
// useSearchParams here. Filtering is client-side over one row per agent (a few
// dozen at most); no Base UI Tabs (keepMounted hazard), just three toggle
// buttons.

type Filter = 'all' | 'you' | 'agent';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'הכול' },
  { value: 'you', label: 'ממתין לך' },
  { value: 'agent', label: 'ממתין לסוכן' },
];

export function ConversationList({
  conversations,
  rolesUnavailable,
}: {
  conversations: ConversationSummary[];
  rolesUnavailable: boolean;
}) {
  const params = useSearchParams();
  const selected = params.get('role');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (q && !c.role.toLowerCase().includes(q)) return false;
      if (filter === 'you') return c.waitingForYou > 0;
      if (filter === 'agent') return c.waitingForAgent;
      return true;
    });
  }, [conversations, filter, query]);

  const agentWaiting = conversations.filter((c) => c.waitingForAgent).length;

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-3 md:w-80 md:shrink-0',
        // Phone: one pane at a time — the list hides once a conversation is open.
        selected && 'max-md:hidden',
      )}
    >
      <h1 className="text-2xl font-bold">פניות הסוכנים</h1>

      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="fleet-conversation-search" className="sr-only">
          חיפוש סוכן
        </label>
        <Input
          id="fleet-conversation-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש סוכן…"
          dir="auto"
          className="h-10 ps-8"
        />
      </div>

      <div className="flex gap-1" role="group" aria-label="סינון שיחות">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className="min-h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            {f.label}
          </button>
        ))}
      </div>

      {rolesUnavailable ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json — מוצגים רק סוכנים שיש להם פעילות.
        </p>
      ) : null}

      <nav aria-label="שיחות עם סוכנים" className="min-h-0 flex-1 md:overflow-y-auto">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {filter === 'you' ? (
              <>
                <p>אין שום דבר שממתין לך</p>
                {agentWaiting > 0 ? (
                  <p className="mt-1">
                    {agentWaiting === 1 ? 'שיחה אחת ממתינה לסוכן' : `${agentWaiting} שיחות ממתינות לסוכנים`}
                  </p>
                ) : null}
              </>
            ) : query ? (
              'לא נמצא סוכן בשם הזה'
            ) : filter === 'agent' ? (
              'אין שיחה שממתינה לסוכן'
            ) : (
              'אין עדיין סוכנים'
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {visible.map((c) => (
              <li key={c.role}>
                <ConversationRow conversation={c} selected={c.role === selected} />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function ConversationRow({ conversation: c, selected }: { conversation: ConversationSummary; selected: boolean }) {
  return (
    <Link
      href={`/admin/fleet?role=${encodeURIComponent(c.role)}`}
      aria-current={selected ? 'page' : undefined}
      className="flex min-h-11 items-center gap-3 px-3 py-2.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-[current=page]:bg-muted"
    >
      <FleetAgentAvatar role={c.role} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <bdi dir="ltr" className="min-w-0 font-semibold wrap-anywhere">
            {c.role}
          </bdi>
          {c.activeGoal ? (
            <>
              <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">מטרה פעילה</span>
            </>
          ) : null}
          {c.lastLabel ? (
            <span className="ms-auto shrink-0 text-xs text-muted-foreground">
              {c.lastAt ? <time dateTime={c.lastAt}>{c.lastLabel}</time> : c.lastLabel}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {c.enabled === false ? <span className="me-1">כבוי ·</span> : null}
            {c.preview ? (
              <>
                {c.previewFromOwner ? 'ממך: ' : null}
                <bdi dir="auto">{c.preview}</bdi>
              </>
            ) : (
              'אין פעילות לאחרונה'
            )}
          </span>
          {c.waitingForAgent && c.waitingForYou === 0 ? (
            <>
              <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">ממתין לסוכן</span>
            </>
          ) : null}
          {c.waitingForYou > 0 ? (
            // The ONE mark with visual weight in the list: waiting for you.
            <Badge variant="warning" className="shrink-0 tabular-nums">
              {c.waitingForYou}
              <span className="sr-only"> ממתינות לך</span>
            </Badge>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
