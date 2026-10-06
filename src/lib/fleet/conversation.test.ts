import { describe, expect, it } from 'vitest';

import {
  buildConversationEvents,
  continuationTitle,
  deriveSubject,
  distinctiveTitle,
  isWaitingOnAgent,
  isWaitingOnOwner,
  layoutStream,
  resolveOwnerTitle,
  rowToEvents,
  summarizeConversations,
  type ConversationEvent,
  type ConversationRequestRow,
} from './conversation';

const T0 = '2026-09-20T09:00:00.000Z';

function row(overrides: Partial<ConversationRequestRow> = {}): ConversationRequestRow {
  return {
    id: 'r1',
    role: 'ops-monitor',
    kind: 'question',
    tier: 0,
    title: 'שאלה',
    body: 'גוף',
    payload: {},
    status: 'pending',
    answer: null,
    created_at: T0,
    answered_at: null,
    expires_at: '2026-09-23T09:00:00.000Z',
    consumed_at: null,
    ...overrides,
  };
}

const shape = (events: ConversationEvent[]) =>
  events.map((e) => (e.type === 'system' ? `system:${e.kind}` : e.type === 'message' ? `message:${e.author}` : e.type));

describe('rowToEvents — the edge cases of plan §2.2', () => {
  it('answer null: just the message', () => {
    expect(shape(rowToEvents(row()))).toEqual(['message:agent']);
  });

  it('verdict only: message + owner verdict at answered_at', () => {
    const events = rowToEvents(
      row({ status: 'answered', answer: 'כן', answered_at: '2026-09-20T10:00:00.000Z' }),
    );
    expect(shape(events)).toEqual(['message:agent', 'verdict']);
    const verdict = events[1];
    expect(verdict.type === 'verdict' && verdict.text).toBe('כן');
    expect(verdict.type === 'verdict' && verdict.verdict).toBe('answered');
    expect(verdict.at).toBe('2026-09-20T10:00:00.000Z');
  });

  it('approval without text still yields a verdict bubble', () => {
    const events = rowToEvents(
      row({ kind: 'approval', status: 'approved', answered_at: '2026-09-20T10:00:00.000Z' }),
    );
    expect(shape(events)).toEqual(['message:agent', 'verdict']);
  });

  it('[הושלם] only (owner task completed by the agent): agent completion at consumed_at', () => {
    const events = rowToEvents(
      row({
        payload: { origin: 'owner' },
        status: 'completed',
        answer: '[הושלם] טופל',
        consumed_at: '2026-09-21T08:00:00.000Z',
      }),
    );
    expect(shape(events)).toEqual(['message:owner', 'completion']);
    expect(events[1].at).toBe('2026-09-21T08:00:00.000Z');
  });

  it('verdict then completion: two authors, two times', () => {
    const events = rowToEvents(
      row({
        kind: 'approval',
        status: 'completed',
        answer: 'מאושר\n\n[הושלם] פורסם',
        answered_at: '2026-09-20T10:00:00.000Z',
        consumed_at: '2026-09-20T12:00:00.000Z',
      }),
    );
    expect(shape(events)).toEqual(['message:agent', 'verdict', 'completion']);
    const [, verdict, completion] = events;
    expect(verdict.type === 'verdict' && verdict.text).toBe('מאושר');
    // After completion the DB no longer says WHICH verdict it was.
    expect(verdict.type === 'verdict' && verdict.verdict).toBeNull();
    expect(completion.type === 'completion' && completion.text).toBe('פורסם');
  });

  it('withdraw: a system line, no expiry, no verdict', () => {
    const events = rowToEvents(row({ status: 'expired', answer: '[withdraw] כבר טופל' }));
    expect(shape(events)).toEqual(['message:agent', 'system:withdraw']);
    const line = events[1];
    expect(line.type === 'system' && line.text).toBe('הסוכן משך את הפנייה: כבר טופל');
  });

  it('[הושלם] mid-sentence stays inside the owner verdict', () => {
    const events = rowToEvents(
      row({ status: 'answered', answer: 'אל תכתוב [הושלם] בכותרת', answered_at: T0 }),
    );
    expect(shape(events)).toEqual(['message:agent', 'verdict']);
    expect(events[1].type === 'verdict' && events[1].text).toBe('אל תכתוב [הושלם] בכותרת');
  });

  it('legacy self-answer (owner origin + verdict): a system line, never a reply bubble', () => {
    const events = rowToEvents(
      row({
        payload: { origin: 'owner' },
        status: 'consumed',
        answer: 'כן',
        answered_at: '2026-09-20T10:00:00.000Z',
        consumed_at: '2026-09-20T11:00:00.000Z',
      }),
    );
    expect(shape(events)).toEqual(['message:owner', 'system:self-answer']);
  });

  it('handoff: "moved from" before the bubble in the target, "moved to" in the source', () => {
    const target = row({
      id: 't1',
      role: 'main',
      payload: { handoff_from: 's1', handoff_from_role: 'qa-runner' },
    });
    const inEvents = rowToEvents(target);
    expect(shape(inEvents)).toEqual(['system:handoff-in', 'message:agent']);
    const inLine = inEvents[0];
    expect(inLine.type === 'system' && inLine.link).toEqual({ role: 'qa-runner', focus: 's1', label: 'למקור' });

    const source = row({ id: 's1', role: 'qa-runner', status: 'consumed', answered_at: T0, consumed_at: T0 });
    const outEvents = rowToEvents(source, {
      handoffsOut: [{ fromId: 's1', toRole: 'main', toId: 't1', at: '2026-09-20T09:30:00.000Z' }],
    });
    expect(shape(outEvents)).toEqual(['message:agent', 'verdict', 'system:handoff-out']);
  });

  it('a thread reply carries its root title', () => {
    const events = rowToEvents(row({ id: 'r2', payload: { thread_root: 'r1' } }), {
      rootTitles: new Map([['r1', 'השורש']]),
    });
    expect(events[0].type === 'message' && events[0].replyToTitle).toBe('השורש');
  });
});

describe('buildConversationEvents — sorted by EVENT time, not row time', () => {
  it('a late completion of an old row lands after newer rows', () => {
    const old = row({
      id: 'old',
      payload: { origin: 'owner' },
      status: 'completed',
      answer: '[הושלם] סוף',
      consumed_at: '2026-09-22T09:00:00.000Z',
    });
    const newer = row({ id: 'new', created_at: '2026-09-21T09:00:00.000Z' });
    const keys = buildConversationEvents([newer, old]).map((e) => e.key);
    expect(keys).toEqual(['old:message', 'new:message', 'old:completion']);
  });

  it('drops goal events older than the loaded window', () => {
    const goal = {
      id: 'g1',
      role: 'ops-monitor',
      title: 'מטרה',
      status: 'completed',
      created_at: '2026-09-01T00:00:00.000Z',
      closed_at: '2026-09-20T10:00:00.000Z',
      last_error: 'סיכום',
    };
    const keys = buildConversationEvents([row()], [goal], { windowStart: T0 }).map((e) => e.key);
    expect(keys).toEqual(['r1:message', 'goal:g1:closed']);
  });
});

describe('turn predicates (§2.3)', () => {
  it('waiting on the owner = pending AND filed by an agent', () => {
    expect(isWaitingOnOwner({ status: 'pending', payload: {} })).toBe(true);
    expect(isWaitingOnOwner({ status: 'pending', payload: { origin: 'owner' } })).toBe(false);
    expect(isWaitingOnOwner({ status: 'answered', payload: {} })).toBe(false);
  });

  it('waiting on the agent = the owner message is open, or a verdict is unconsumed', () => {
    expect(isWaitingOnAgent({ status: 'pending', payload: { origin: 'owner' } })).toBe(true);
    expect(isWaitingOnAgent({ status: 'approved', payload: {} })).toBe(true);
    expect(isWaitingOnAgent({ status: 'consumed', payload: {} })).toBe(false);
    expect(isWaitingOnAgent({ status: 'pending', payload: {} })).toBe(false);
  });
});

describe('layoutStream', () => {
  const NOW = Date.parse('2026-09-20T15:00:00.000Z');

  it('groups same author within 5 minutes, breaks on author, gap or system line', () => {
    const rows = [
      row({ id: 'a', created_at: '2026-09-20T09:00:00.000Z' }),
      row({ id: 'b', created_at: '2026-09-20T09:04:00.000Z' }),
      row({ id: 'c', created_at: '2026-09-20T09:20:00.000Z' }),
      row({ id: 'd', created_at: '2026-09-20T09:21:00.000Z', payload: { origin: 'owner' } }),
    ];
    const items = layoutStream(buildConversationEvents(rows), NOW);
    expect(items.map((i) => (i.type === 'group' ? `${i.author}:${i.events.length}` : i.type))).toEqual([
      'day',
      'agent:2',
      'agent:1',
      'owner:1',
    ]);
    expect(items[0].type === 'day' && items[0].label).toBe('היום');
  });

  it('labels yesterday and starts a new group on a new day', () => {
    const rows = [
      row({ id: 'a', created_at: '2026-09-19T20:58:00.000Z' }), // 23:58 Israel, yesterday
      row({ id: 'b', created_at: '2026-09-19T21:01:00.000Z' }), // 00:01 Israel, today
    ];
    const items = layoutStream(buildConversationEvents(rows), NOW);
    expect(items.map((i) => (i.type === 'day' ? i.label : i.type))).toEqual(['אתמול', 'group', 'היום', 'group']);
  });

  it('folds 3+ consecutive unanswered expired messages into one run, keeps 2 as bubbles', () => {
    const expired = (id: string, minute: number) =>
      row({ id, status: 'expired', created_at: `2026-09-20T09:${String(minute).padStart(2, '0')}:00.000Z` });
    const three = layoutStream(buildConversationEvents([expired('a', 0), expired('b', 10), expired('c', 20)]), NOW);
    expect(three.map((i) => i.type)).toEqual(['day', 'expired-run']);
    const two = layoutStream(buildConversationEvents([expired('a', 0), expired('b', 10)]), NOW);
    expect(two.map((i) => i.type)).toEqual(['day', 'group', 'group']);
  });

  it('a withdrawn row is not "expired without an answer"', () => {
    const rows = ['a', 'b', 'c'].map((id, n) =>
      row({ id, status: 'expired', answer: '[withdraw] x', created_at: `2026-09-20T09:0${n}:00.000Z` }),
    );
    const items = layoutStream(buildConversationEvents(rows), NOW);
    expect(items.some((i) => i.type === 'expired-run')).toBe(false);
  });
});

describe('summarizeConversations', () => {
  it('unions fleet.json with roles seen in data and counts turns', () => {
    const summaries = summarizeConversations({
      rows: [
        row({ id: 'a', role: 'social-manager', title: '🔴 פרסום בפועל: אינסטגרם — פוסט חתונה' }),
        row({ id: 'b', role: 'retired-role', created_at: '2026-09-19T09:00:00.000Z' }),
        row({
          id: 'c',
          role: 'ops-monitor',
          status: 'approved',
          kind: 'approval',
          answered_at: '2026-09-20T10:00:00.000Z',
          created_at: '2026-09-18T09:00:00.000Z',
        }),
      ],
      pending: [
        { id: 'a', role: 'social-manager', status: 'pending', payload: {} },
        { id: 'x', role: 'main', status: 'pending', payload: { origin: 'owner' } },
      ],
      goals: [{ role: 'qa-runner', status: 'active' }],
      roles: [
        { name: 'social-manager', enabled: true },
        { name: 'ops-monitor', enabled: true },
        { name: 'qa-runner', enabled: false },
        { name: 'main', enabled: true },
      ],
      nowMs: Date.parse('2026-09-20T15:00:00.000Z'),
    });
    const by = new Map(summaries.map((s) => [s.role, s]));
    expect(summaries[0].role).toBe('social-manager'); // waiting for you sorts first
    expect(by.get('social-manager')).toMatchObject({
      waitingForYou: 1,
      preview: 'פוסט חתונה',
      enabled: true,
      lastLabel: '12:00',
    });
    expect(by.get('retired-role')?.lastLabel).toBe('אתמול');
    expect(by.get('main')).toMatchObject({ waitingForYou: 0, waitingForAgent: true, lastAt: null });
    expect(by.get('ops-monitor')).toMatchObject({ waitingForAgent: true, previewFromOwner: true, preview: 'אישרת' });
    expect(by.get('qa-runner')).toMatchObject({ activeGoal: true, waitingForAgent: true, enabled: false });
    expect(by.get('retired-role')).toMatchObject({ enabled: null });
    // roles with no activity sort last
    expect(summaries.map((s) => s.role).slice(-2).sort()).toEqual(['main', 'qa-runner']);
  });
});

describe('composer titles', () => {
  it('derives the subject from the first non-empty line, capped at 200', () => {
    expect(deriveSubject('\n\n  שורה ראשונה  \nשנייה')).toBe('שורה ראשונה');
    expect(deriveSubject('א'.repeat(300))).toHaveLength(200);
  });

  it('falls back to "הודעה ל-<role>" when subject and first line are too short', () => {
    // the first non-empty line is 'כן' (2 chars) — too short, so the fallback
    expect(resolveOwnerTitle('', 'כן\nועוד טקסט ארוך', 'main')).toBe('הודעה ל-main');
    expect(resolveOwnerTitle('א', 'גם', 'main')).toBe('הודעה ל-main');
    expect(resolveOwnerTitle('נושא ברור', 'גוף', 'main')).toBe('נושא ברור');
    expect(resolveOwnerTitle('', 'בדיקת מערכת\nפרטים', 'main')).toBe('בדיקת מערכת');
  });

  it('continuation title never doubles the prefix and stays within 200', () => {
    expect(continuationTitle('שאלה')).toBe('המשך: שאלה');
    expect(continuationTitle('המשך: שאלה')).toBe('המשך: שאלה');
    expect(continuationTitle('א'.repeat(200))).toHaveLength(200);
  });

  it('distinctiveTitle keeps the part after the last em-dash separator', () => {
    expect(distinctiveTitle('פרסום — אינסטגרם — פוסט')).toBe('פוסט');
    expect(distinctiveTitle('בלי מפריד')).toBe('בלי מפריד');
  });
});
