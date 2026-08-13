'use client';

import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatIsraelTime } from '@/lib/date';
import { chatAuthorDisplayName, type ChatMessageRow } from '@/lib/console/chat';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// Internal agent-to-agent chat (plan "שלב 2"). Presentational + composer
// only — the message list, load, and Realtime subscription are owned by
// softphone-panel.tsx (state lifted there specifically so the unread count
// keeps counting while the panel is COLLAPSED, i.e. while this component
// isn't even mounted; see that file's chat-state effect for why).
//
// No relative-time helper exists in src/lib/date.ts (checked before writing
// this) — formatIsraelTime (absolute HH:MM, Israel wall clock) is the
// existing helper and is used as-is rather than hand-rolling a "5 דקות
// לפני"-style formatter.
//
// Honest-UI discipline (save_rsvp / AiHandoffSection precedent): sending
// never optimistically appends to the list. The DB CHECK constraint is the
// real length gate (client-side maxLength is UX only); a message only
// renders once it round-trips through the same Realtime-driven list this
// component receives as a prop.
export type { ChatMessageRow };

interface RosterLookup {
  userId: string;
  displayName: string;
}

// Mirrors the DB CHECK in
// supabase/migrations/20260812175512_callcenter_console_chat_messages.sql
// (char_length(body) <= 2000) — kept as a named constant here so a future
// change to the DB constraint has exactly one client-side number to update.
const CHAT_BODY_MAX_LEN = 2000;

export function ChatSection({
  selfUserId,
  roster,
  messages,
  loaded,
}: {
  selfUserId: string | null;
  roster: RosterLookup[];
  messages: ChatMessageRow[];
  loaded: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message on every list change — a peer's
  // incoming message pulls the view down too, not just my own send.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || !selfUserId || sending) return;
    if (body.length > CHAT_BODY_MAX_LEN) {
      setError(`הודעה ארוכה מדי (עד ${CHAT_BODY_MAX_LEN} תווים)`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from('console_chat_messages')
        .insert({ author_id: selfUserId, body });
      if (insertError) {
        setError('שליחת ההודעה נכשלה');
        return;
      }
      setDraft('');
    } catch {
      setError('שליחת ההודעה נכשלה');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a plain newline (native textarea default —
    // only Enter-without-Shift is intercepted).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">צ׳אט צוות</h3>

      {!loaded ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      ) : messages.length === 0 ? (
        <p className="text-xs text-muted-foreground">אין הודעות עדיין.</p>
      ) : (
        <div
          ref={listRef}
          className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2"
        >
          {messages.map((m) => {
            const mine = m.authorId === selfUserId;
            return (
              <div key={m.id} className={cn('flex flex-col gap-0.5 text-xs', mine ? 'items-end' : 'items-start')}>
                <span className="text-[10px] text-muted-foreground">
                  {chatAuthorDisplayName(m.authorId, selfUserId, roster)} · {formatIsraelTime(m.createdAt)}
                </span>
                <span
                  className={cn(
                    'max-w-[85%] wrap-anywhere whitespace-pre-wrap rounded-md px-2 py-1',
                    mine
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-card',
                  )}
                >
                  {m.body}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="הודעה לצוות…"
          rows={2}
          maxLength={CHAT_BODY_MAX_LEN}
          disabled={!selfUserId || sending}
          aria-label="הודעה לצוות"
          className="min-h-0 text-xs"
        />
        <Button
          type="button"
          size="icon-sm"
          disabled={!draft.trim() || !selfUserId || sending}
          onClick={() => void send()}
          aria-label="שליחת הודעה"
        >
          <Send className="size-3.5" aria-hidden />
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
