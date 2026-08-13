// Pure helpers for the internal agent-to-agent chat (console_chat_messages —
// plan "שלב 2"). Extracted out of chat-section.tsx / softphone-panel.tsx so
// the unread-count and display-name logic has a testable seam independent of
// React state and Realtime — same discipline as call-snapshot.ts's pure
// reducer for the softphone's call state.

export interface ChatMessageRow {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

interface RosterLookup {
  userId: string;
  displayName: string;
}

/**
 * Messages authored by someone else, strictly newer than `lastReadAt`. A
 * null `lastReadAt` (nothing marked read yet — e.g. before the initial load
 * resolves) counts as zero unread, never "everything", matching
 * softphone-panel.tsx's mark-as-read effect (existing history at first load
 * is never treated as unread).
 */
export function computeUnreadChatCount(
  messages: readonly ChatMessageRow[],
  selfUserId: string | null,
  lastReadAt: string | null,
): number {
  if (!lastReadAt) return 0;
  return messages.filter((m) => m.authorId !== selfUserId && m.createdAt > lastReadAt).length;
}

/** 'אני' for the caller's own messages, else the roster's display name, else a safe fallback. */
export function chatAuthorDisplayName(
  authorId: string,
  selfUserId: string | null,
  roster: readonly RosterLookup[],
): string {
  if (authorId === selfUserId) return 'אני';
  return roster.find((r) => r.userId === authorId)?.displayName ?? 'נציג';
}
