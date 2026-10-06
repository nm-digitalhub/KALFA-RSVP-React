import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OWNER_AGENT_SYSTEM_PROMPT } from '@/lib/owner-agent/consumer/reply-text';
import type { OwnerAgentRunInput, OwnerAgentRunResult } from '@/lib/owner-agent/runner';

import { REPORT_MODEL_RUN_TIMEOUT_MS } from './budgets';
import { TEMPLATE_PLACEHOLDER } from './content';
import { TEMPLATE_SUMMARY_MAX, buildModelReportContent, buildReportPrompt, templateSummary } from './model-content';
import { reportPeriod } from './planner';

const MORNING = reportPeriod('2026-09-28', '08:00', 'Asia/Jerusalem');
const NOW = Date.parse('2026-09-28T05:02:00Z');
const INSTRUCTIONS = 'רק אירועים חדשים והכנסות, בשורה אחת';

function result(text: string): OwnerAgentRunResult {
  return {
    text,
    followups: [],
    sessionPersisted: true,
    costUsd: 0.01,
    sessionId: 's-1',
    toolNames: ['events_pipeline', 'execute_sql'],
    turns: 3,
    sqlUnavailable: false,
  } as OwnerAgentRunResult;
}

describe('buildReportPrompt', () => {
  it('carries the period, the snapshot rule and the owner’s instructions as the request', () => {
    const p = buildReportPrompt(MORNING, INSTRUCTIONS, NOW);
    expect(p).toContain(`תקופת הדוח: ${MORNING.label}`);
    expect(p).toContain(MORNING.sinceIso);
    expect(p).toContain(MORNING.untilIso);
    expect(p).toContain('תמונת מצב');
    expect(p.endsWith(`בקשת הבעלים לדוח:\n${INSTRUCTIONS}`)).toBe(true);
  });
});

describe('buildModelReportContent', () => {
  it('runs once: no resume, no session file, no attachments, not structured, its own timeout, the recipient’s permissions', async () => {
    const run = vi.fn(async (_input: OwnerAgentRunInput) => result('*סיכום*\nשני אירועים חדשים'));
    const c = await buildModelReportContent(run, INSTRUCTIONS, ['view_events'], MORNING, NOW);
    expect(run).toHaveBeenCalledTimes(1);
    const input = run.mock.calls[0][0];
    expect(input.resumeSessionId).toBeUndefined();
    expect(input.persistSession).toBe(false);
    expect(input.attachments).toBeUndefined();
    expect(input.structured).toBeUndefined();
    expect(input.timeoutMs).toBe(REPORT_MODEL_RUN_TIMEOUT_MS);
    expect(input.permissions).toEqual(['view_events']);
    expect(input.systemPrompt).toBe(OWNER_AGENT_SYSTEM_PROMPT);
    expect(c).toMatchObject({
      kind: 'custom',
      text: '*סיכום*\nשני אירועים חדשים',
      sections: [],
      toolNames: ['events_pipeline', 'execute_sql'],
      permissions: ['view_events'],
    });
    // The custom template's two params, exactly — nothing padded for the numeric one.
    expect(c.templateParams).toEqual([MORNING.label, 'סיכום']);
  });

  it('an empty answer throws (report.ts falls back to the numbers)', async () => {
    await expect(buildModelReportContent(async () => result('  \n '), INSTRUCTIONS, [], MORNING, NOW)).rejects.toThrow(
      'empty_answer',
    );
  });
});

describe('templateSummary', () => {
  it('first non-empty line, markup stripped, single-line, capped', () => {
    expect(templateSummary('\n\n*כותרת*  \nעוד')).toBe('כותרת');
    expect(templateSummary('')).toBe(TEMPLATE_PLACEHOLDER);
    const long = templateSummary('א'.repeat(500));
    expect(long.length).toBe(TEMPLATE_SUMMARY_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('never carries a line break, a tab or a run of 4+ spaces (Meta refuses those in a param)', () => {
    for (const raw of ['א\tב    ג', 'א\u2028ב', 'א\u2029ב\vג\fד', 'א\u0085ב', 'a\r\nb']) {
      const out = templateSummary(raw);
      expect(out).not.toMatch(/[\r\n\t\v\f\u0085\u2028\u2029]/);
      expect(out).not.toMatch(/ {4,}/);
      expect(out.length).toBeGreaterThan(0);
    }
    const long = templateSummary(`${'א '.repeat(300)}\u2028סוף`);
    expect(long.length).toBeLessThanOrEqual(TEMPLATE_SUMMARY_MAX);
  });
});
