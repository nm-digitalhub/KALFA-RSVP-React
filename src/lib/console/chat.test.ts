import { describe, expect, it } from 'vitest';

import { chatAuthorDisplayName, computeUnreadChatCount, type ChatMessageRow } from './chat';

const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';

function msg(id: string, authorId: string, createdAt: string): ChatMessageRow {
  return { id, authorId, body: `msg ${id}`, createdAt, };
}

describe('computeUnreadChatCount', () => {
  it('is zero before any read watermark is established', () => {
    const messages = [msg('1', AGENT_B, '2026-08-12T10:00:00.000Z')];
    expect(computeUnreadChatCount(messages, AGENT_A, null)).toBe(0);
  });

  it('counts only messages strictly newer than lastReadAt', () => {
    const messages = [
      msg('1', AGENT_B, '2026-08-12T10:00:00.000Z'),
      msg('2', AGENT_B, '2026-08-12T10:05:00.000Z'),
      msg('3', AGENT_B, '2026-08-12T10:10:00.000Z'),
    ];
    expect(computeUnreadChatCount(messages, AGENT_A, '2026-08-12T10:05:00.000Z')).toBe(1);
  });

  it('never counts the caller\'s own messages as unread', () => {
    const messages = [
      msg('1', AGENT_A, '2026-08-12T10:00:00.000Z'),
      msg('2', AGENT_B, '2026-08-12T10:01:00.000Z'),
    ];
    // lastReadAt before both — only the OTHER author's message should count.
    expect(computeUnreadChatCount(messages, AGENT_A, '2026-08-12T09:00:00.000Z')).toBe(1);
  });

  it('is zero once every message is at or before the watermark', () => {
    const messages = [msg('1', AGENT_B, '2026-08-12T10:00:00.000Z')];
    expect(computeUnreadChatCount(messages, AGENT_A, '2026-08-12T10:00:00.000Z')).toBe(0);
  });

  it('is zero for an empty message list', () => {
    expect(computeUnreadChatCount([], AGENT_A, '2026-08-12T10:00:00.000Z')).toBe(0);
  });
});

describe('chatAuthorDisplayName', () => {
  const roster = [{ userId: AGENT_B, displayName: 'רותם כהן' }];

  it('labels the caller\'s own messages "אני"', () => {
    expect(chatAuthorDisplayName(AGENT_A, AGENT_A, roster)).toBe('אני');
  });

  it('resolves another author from the roster', () => {
    expect(chatAuthorDisplayName(AGENT_B, AGENT_A, roster)).toBe('רותם כהן');
  });

  it('falls back to a generic label for an author missing from the roster', () => {
    expect(chatAuthorDisplayName('unknown-agent', AGENT_A, roster)).toBe('נציג');
  });

  it('falls back to a generic label when selfUserId is null (not yet resolved)', () => {
    expect(chatAuthorDisplayName(AGENT_B, null, roster)).toBe('רותם כהן');
  });
});
