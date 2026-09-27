import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { BILLING_SUMMARY_ID, BILLING_SUMMARY_PERMISSION } from '@/lib/owner-agent/tools/billing-summary';
import {
  CAMPAIGNS_STATUS_SUMMARY_ID,
  CAMPAIGNS_STATUS_SUMMARY_PERMISSION,
} from '@/lib/owner-agent/tools/campaigns-status-summary';
import { EVENTS_PIPELINE_ID, EVENTS_PIPELINE_PERMISSION } from '@/lib/owner-agent/tools/events-pipeline';
import { INQUIRIES_SUMMARY_ID, INQUIRIES_SUMMARY_PERMISSION } from '@/lib/owner-agent/tools/inquiries-summary';
import { RSVP_TOTALS_ID, RSVP_TOTALS_PERMISSION } from '@/lib/owner-agent/tools/rsvp-totals';
import { VOICE_CALLS_SUMMARY_ID, VOICE_CALLS_SUMMARY_PERMISSION } from '@/lib/owner-agent/tools/voice-calls-summary';
import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeCountClient } from '@/test/fake-count-client';

import {
  REPORT_SECTION_PERMISSIONS,
  TEMPLATE_PLACEHOLDER,
  buildReportContent,
  permittedSections,
  templateParam,
  type ReportSection,
} from './content';
import { reportPeriod } from './planner';

type AdminClient = ReturnType<typeof createAdminClient>;

// The 00:00 report of 28.9 covers the Israel day 27.9: [26.9 21:00Z, 27.9 21:00Z).
const MIDNIGHT = reportPeriod('2026-09-28', '00:00', 'Asia/Jerusalem');
// The 08:00 report of 28.9: [27.9 21:00Z, 28.9 05:00Z) + snapshot.
const MORNING = reportPeriod('2026-09-28', '08:00', 'Asia/Jerusalem');
const NOW = Date.parse('2026-09-28T05:03:00Z');

const IN_DAY = '2026-09-27T10:00:00Z'; // inside the 27.9 day
const IN_NIGHT = '2026-09-28T01:00:00Z'; // inside 00:00–08:00 on 28.9
const pii = { name: 'דנה כהן', phone: '+972501234567', message: 'טקסט פרטי' };

function db() {
  return createFakeCountClient(
    {
      events: [
        { id: 'e1', ...pii, status: 'active', event_type: 'wedding', created_at: IN_DAY, event_date: '2026-09-28T17:00:00Z' },
        { id: 'e2', ...pii, status: 'draft', event_type: 'wedding', created_at: IN_NIGHT, event_date: null },
      ],
      guests: [{ id: 'g1', ...pii, status: 'pending', events: { status: 'active' } }],
      rsvp_responses: [
        { id: 'r1', created_at: IN_DAY, events: { status: 'active' } },
        { id: 'r2', created_at: IN_DAY, events: { status: 'active' } },
      ],
      campaigns: [
        { id: 'k1', status: 'active', capture_status: 'authorized', charge_status: 'charged', charged_at: IN_DAY, created_at: IN_DAY, release_status: null },
      ],
      billing_credits: [],
      contact_messages: [{ id: 'c1', ...pii, status: 'new', created_at: IN_DAY }],
      callback_requests: [],
      call_attempts: [{ id: 'a1', status: 'completed', created_at: IN_DAY }],
    },
    {
      rpc: {
        owner_agent_billing_sums: () => ({
          data: [{ charged_amount: 1350.5, credit_applied_amount: 0, unvoided_credit_amount: 0, credit_granted_amount: 0 }],
          error: null,
        }),
        owner_agent_rsvp_people_totals: () => ({ data: [{ invited_people: 1, attending_people: 0 }], error: null }),
      },
    },
  );
}

const ALL: ReportSection[] = Object.keys(REPORT_SECTION_PERMISSIONS) as ReportSection[];

describe('section permissions', () => {
  it("each section needs exactly its read tool's permission, under the tool's id", () => {
    expect(REPORT_SECTION_PERMISSIONS).toEqual({
      [EVENTS_PIPELINE_ID]: EVENTS_PIPELINE_PERMISSION,
      [RSVP_TOTALS_ID]: RSVP_TOTALS_PERMISSION,
      [BILLING_SUMMARY_ID]: BILLING_SUMMARY_PERMISSION,
      [INQUIRIES_SUMMARY_ID]: INQUIRIES_SUMMARY_PERMISSION,
      [CAMPAIGNS_STATUS_SUMMARY_ID]: CAMPAIGNS_STATUS_SUMMARY_PERMISSION,
      [VOICE_CALLS_SUMMARY_ID]: VOICE_CALLS_SUMMARY_PERMISSION,
    });
  });

  it('permittedSections keeps only the granted ones; none granted = nothing', () => {
    expect(permittedSections([])).toEqual([]);
    expect(permittedSections(['view_events'])).toEqual(['events_pipeline', 'rsvp_totals']);
    expect(permittedSections(['view_billing', 'manage_voice'])).toEqual(['billing_summary', 'voice_calls_summary']);
    // view_webhooks has no report section.
    expect(permittedSections(['view_webhooks'])).toEqual([]);
  });
});

describe('buildReportContent', () => {
  it('reports the period only, from the cores, with every section granted', async () => {
    const { client } = db();
    const c = await buildReportContent(client as unknown as AdminClient, ALL, MIDNIGHT, NOW);
    expect(c.text.split('\n')).toEqual([
      'דוח פעילות — 27.9',
      '',
      'אירועים חדשים: 1', // e1; e2 was created on the 28th
      'אישורי הגעה חדשים: 2',
      'הכנסות: 1,350.5 ₪ (1 חיובים)',
      'פניות חדשות: 1, בקשות חזרה: 0',
      'קמפיינים חדשים: 1',
      'שיחות AI: 1 (הושלמו 1)',
    ]);
    expect(c.templateParams).toEqual(['27.9', '1', '2', '1,350.5 ₪']);
    expect(c.sections).toEqual(ALL);
  });

  it('08:00 adds the current snapshot', async () => {
    const { client } = db();
    const c = await buildReportContent(client as unknown as AdminClient, ['events_pipeline', 'rsvp_totals'], MORNING, NOW);
    expect(c.text.split('\n')).toEqual([
      'דוח פעילות — 28.9 00:00–08:00',
      '',
      'אירועים חדשים: 1', // e2 (draft) was created at 01:00
      'אישורי הגעה חדשים: 0',
      '',
      'מצב נוכחי:',
      'אירועים פעילים: 1, מתוכם היום: 1',
      'אורחים שטרם ענו (באירועים פעילים): 1',
    ]);
  });

  it('a section without its permission is absent from the text and a placeholder in the template', async () => {
    const { client, calls, rpcCalls } = db();
    const c = await buildReportContent(client as unknown as AdminClient, ['inquiries_summary'], MIDNIGHT, NOW);
    expect(c.text).not.toMatch(/הכנסות|אירועים|אישורי/);
    expect(c.templateParams).toEqual(['27.9', TEMPLATE_PLACEHOLDER, TEMPLATE_PLACEHOLDER, TEMPLATE_PLACEHOLDER]);
    // The ungranted cores were never queried.
    expect(new Set(calls.map((q) => q.table))).toEqual(new Set(['contact_messages', 'callback_requests']));
    expect(rpcCalls).toEqual([]);
  });

  it('no personal data reaches the text', async () => {
    const { client } = db();
    const c = await buildReportContent(client as unknown as AdminClient, ALL, MORNING, NOW);
    for (const value of Object.values(pii)) expect(c.text).not.toContain(value);
  });

  it('a failed core read throws instead of reporting a 0', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['events'] });
    await expect(buildReportContent(client as unknown as AdminClient, ['events_pipeline'], MIDNIGHT, NOW)).rejects.toThrow();
  });

  it('a read that hangs past the budget throws report_content_timeout', async () => {
    // A builder whose every filter returns itself and which never settles.
    const builder: Record<string, unknown> = new Proxy(
      {},
      { get: (_t, key) => (key === 'then' ? () => undefined : () => builder) },
    );
    const hanging = { from: () => builder, rpc: () => new Promise(() => {}) };
    await expect(
      buildReportContent(hanging as unknown as AdminClient, ['inquiries_summary'], MIDNIGHT, NOW, 20),
    ).rejects.toThrow('report_content_timeout');
  });
});

describe('templateParam', () => {
  it('is single-line, without runs of spaces, and never empty', () => {
    expect(templateParam('a\nb\tc     d')).toBe('a b c d');
    expect(templateParam('  \n ')).toBe(TEMPLATE_PLACEHOLDER);
  });
});
