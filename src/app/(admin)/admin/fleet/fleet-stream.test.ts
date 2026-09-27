import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// The Server Actions module pulls the server-only data layer; the render only
// needs the references.
vi.mock('./actions', () => ({
  answerFleetRequestAction: vi.fn(),
  createFleetRequestAction: vi.fn(),
  createFleetGoalAction: vi.fn(),
  pauseFleetGoalAction: vi.fn(),
  resumeFleetGoalAction: vi.fn(),
  abandonFleetGoalAction: vi.fn(),
}));

import { buildConversationEvents, layoutStream, type ConversationRequestRow } from '@/lib/fleet/conversation';
import { reachability } from '@/lib/fleet/reachability';
import { ConversationList } from './conversation-list';
import { ComposerProvider, FleetComposer } from './fleet-composer';
import { FleetStream } from './fleet-stream';

const NOW = Date.parse('2026-09-20T15:00:00.000Z');

function row(overrides: Partial<ConversationRequestRow>): ConversationRequestRow {
  return {
    id: 'r1',
    role: 'ops-monitor',
    kind: 'question',
    tier: 0,
    title: 'שאלה',
    body: 'גוף ההודעה',
    payload: {},
    status: 'pending',
    answer: null,
    created_at: '2026-09-20T09:00:00.000Z',
    answered_at: null,
    expires_at: '2026-09-21T09:00:00.000Z',
    consumed_at: null,
    ...overrides,
  };
}

function render(rows: ConversationRequestRow[], lastOwnerPendingId: string | null = null): string {
  const items = layoutStream(buildConversationEvents(rows), NOW);
  return renderToStaticMarkup(
    createElement(
      ComposerProvider,
      { role: 'ops-monitor' },
      createElement(FleetStream, {
        items,
        role: 'ops-monitor',
        nowMs: NOW,
        lastOwnerPendingId,
        ownerEta: 'ייקלט תוך כדקה',
      }),
    ),
  );
}

// Count occurrences of a substring.
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('FleetStream render', () => {
  it('puts approve/deny ONLY on the agent bubble that is still pending, and keeps its command open', () => {
    const html = render([
      row({
        id: 'a1',
        kind: 'approval',
        title: 'לפרוס?',
        payload: { prepared_command: 'npm run deploy -- --prod' },
      }),
      row({ id: 'o1', payload: { origin: 'owner' }, title: 'בדוק גיבוי', created_at: '2026-09-20T10:00:00.000Z' }),
    ]);
    expect(count(html, 'aria-label="אשר: לפרוס?"')).toBe(1);
    expect(count(html, 'aria-label="דחה: לפרוס?"')).toBe(1);
    // the owner's own pending message gets no verdict buttons (B1)
    expect(html).not.toContain('אשר: בדוק גיבוי');
    expect(html).not.toContain('השב: בדוק גיבוי');
    // pending approval: the command is shown, not folded in <details>
    expect(html).toContain('הפקודה לאישור:');
    expect(html).toContain('npm run deploy -- --prod');
    expect(html).toContain('data-waiting-owner="true"');
    expect(html).toContain('id="msg-a1"');
  });

  it('never fills a bubble with the indigo primary', () => {
    const html = render([
      row({ id: 'a1' }),
      row({ id: 'o1', payload: { origin: 'owner' }, created_at: '2026-09-20T10:00:00.000Z' }),
    ]);
    expect(html).not.toMatch(/data-variant="default"/);
    expect(html).toContain('data-variant="muted"');
    expect(html).toContain('data-variant="outline"');
  });

  it('shows the completion summary of an owner task and "בוצע" under the owner message', () => {
    const html = render([
      row({
        id: 'o1',
        payload: { origin: 'owner' },
        status: 'completed',
        answer: '[הושלם] הגיבוי תקין, 3 קבצים',
        consumed_at: '2026-09-20T11:00:00.000Z',
      }),
    ]);
    expect(html).toContain('הגיבוי תקין, 3 קבצים');
    expect(html).toContain('בוצע');
    // a closed message can be continued
    expect(html).toContain('aria-label="השב על: שאלה"');
  });

  it('shows the delivery ETA only under the last pending owner message', () => {
    const html = render(
      [
        row({ id: 'o1', payload: { origin: 'owner' }, created_at: '2026-09-20T09:00:00.000Z' }),
        row({ id: 'o2', payload: { origin: 'owner' }, created_at: '2026-09-20T09:30:00.000Z' }),
      ],
      'o2',
    );
    expect(count(html, 'נשלח · ייקלט תוך כדקה')).toBe(1);
  });

  it('isolates paths in the body and never truncates the text', () => {
    const long = `ראה plans/fleet.md ${'מילה '.repeat(400)}סוף`;
    const html = render([row({ id: 'a1', body: long })]);
    expect(html).toContain('<bdi dir="ltr">plans/fleet.md</bdi>');
    expect(html).toContain('סוף');
    expect(html).not.toMatch(/line-clamp|class="[^"]*\btruncate\b/);
  });

  it('folds 3+ expired requests into one expandable line', () => {
    const expired = (id: string, minute: number) =>
      row({ id, status: 'expired', created_at: `2026-09-20T09:${String(minute).padStart(2, '0')}:00.000Z` });
    const html = render([expired('e1', 0), expired('e2', 10), expired('e3', 20)]);
    expect(html).toContain('3 פניות פגו ללא מענה');
    expect(html).toContain('opacity-60');
  });
});

describe('FleetComposer render', () => {
  const role = { name: 'ops-monitor', enabled: true, tier: 0, reactive: ['owner_direct_request'], scheduleSlots: 0 };
  const renderComposer = (enabled: boolean) =>
    renderToStaticMarkup(
      createElement(
        ComposerProvider,
        { role: 'ops-monitor' },
        createElement(FleetComposer, {
          reach: reachability({ ...role, enabled }),
          goalReach: reachability({ ...role, enabled }, 'goal_due'),
          hasClosedExchange: true,
          autoFocus: false,
        }),
      ),
    );

  it('starts in "new message" mode with a visible subject and the cost line before sending', () => {
    const html = renderComposer(true);
    expect(html).toContain('נושא:');
    expect(html).toContain('שליחה תפעיל את הסוכן — תוך כדקה');
    expect(html).toContain('הודעה חדשה נשלחת בלי הקשר');
    expect(html).toContain('name="body"');
    expect(html).toContain('max-md:ps-14');
  });

  it('stays visible but disabled for a switched-off agent, with the reason', () => {
    const html = renderComposer(false);
    expect(html).toContain('הסוכן כבוי');
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });
});

describe('ConversationList render', () => {
  it('marks only "waiting for you" with a warning badge and prefixes owner previews', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        rolesUnavailable: false,
        conversations: [
          {
            role: 'social-manager',
            enabled: true,
            lastAt: '2026-09-20T09:00:00.000Z',
            lastLabel: '12:00',
            preview: 'פוסט',
            previewFromOwner: false,
            waitingForYou: 3,
            waitingForAgent: false,
            activeGoal: false,
          },
          {
            role: 'main',
            enabled: false,
            lastAt: '2026-09-19T09:00:00.000Z',
            lastLabel: 'אתמול',
            preview: 'בדוק',
            previewFromOwner: true,
            waitingForYou: 0,
            waitingForAgent: true,
            activeGoal: true,
          },
        ],
      }),
    );
    expect(count(html, 'data-variant="warning"')).toBe(1);
    expect(html).toContain('ממך: ');
    expect(html).toContain('ממתין לסוכן');
    expect(html).toContain('מטרה פעילה');
    expect(html).toContain('כבוי');
    expect(html).toContain('aria-label="שיחות עם סוכנים"');
  });
});
