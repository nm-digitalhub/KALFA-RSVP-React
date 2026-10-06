import 'server-only';

import { OWNER_AGENT_MAX_TURNS, OWNER_AGENT_MODEL } from '@/lib/owner-agent/consumer/budgets';
import { answerBody, OWNER_AGENT_SYSTEM_PROMPT } from '@/lib/owner-agent/consumer/reply-text';
import type { OwnerAgentRunInput, OwnerAgentRunResult } from '@/lib/owner-agent/runner';
import type { OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import { formatIsraelDateTime, formatIsraelWeekday } from '@/lib/date';

import { REPORT_MODEL_RUN_TIMEOUT_MS } from './budgets';
import { TEMPLATE_PLACEHOLDER, templateParam, type ReportContent } from './content';
import type { ReportPeriod } from './planner';

// A report WITH the owner's "הנחיות לדוח": the text is
// written by the model — the same runner, system prompt and permission set as
// an answer (runner.ts runOwnerAgent, bound in consumer/main.ts) — from a FIXED
// wrapper prompt: the report period, then the instructions, framed as the
// owner's own request. Differences from an answer, all on purpose:
//   - never resumed, never remembered and never persisted (persistSession:
//     false → --no-session-persistence): a report is not a conversation turn;
//   - no attachments, no structured output (no follow-up buttons on a report);
//   - its own run timeout (budgets.ts), because it runs inside the REPLY queue's
//     expiry — see report.ts for why it runs there.
//
// The instructions are the owner's text, typed on the owner-only admin screen;
// they are handed to the model as the request, the same trust an owner's
// WhatsApp question gets. The recipient's permissions (resolved at send time)
// decide the count tools, exactly as for that recipient's own question.
//
// A failed or empty run THROWS (an OwnerAgentRunError, or `empty_answer`); report.ts then
// sends the deterministic report instead, with a note (graceful degradation),
// rather than paying for a second model run.

/** Meta allows up to 1024 characters for the whole template body; the summary parameter gets a short line. */
export const TEMPLATE_SUMMARY_MAX = 200;

export function buildReportPrompt(period: ReportPeriod, instructions: string, nowMs: number): string {
  return [
    `עכשיו יום ${formatIsraelWeekday(nowMs)}, ${formatIsraelDateTime(nowMs)} (שעון ישראל).`,
    '',
    'זה דוח יזום שהבעלים ביקש לקבל בשעה קבועה. אין שיחה פתוחה: כתוב את הדוח עצמו, בלי שאלות חוזרות.',
    `תקופת הדוח: ${period.label} (מ-${period.sinceIso} עד ${period.untilIso}, לא כולל).`,
    period.includeSnapshot ? 'הוסף גם תמונת מצב נוכחית.' : 'רק מה שקרה בתקופה.',
    '',
    'בקשת הבעלים לדוח:',
    instructions,
  ].join('\n');
}

/** First non-empty line, single-line, cut to the template limit — or the placeholder. */
export function templateSummary(text: string): string {
  const first = text
    .split('\n')
    .map((l) => l.replace(/[*_~`]/g, '').trim())
    .find((l) => l.length > 0);
  if (!first) return TEMPLATE_PLACEHOLDER;
  const single = templateParam(first);
  return single.length > TEMPLATE_SUMMARY_MAX ? `${single.slice(0, TEMPLATE_SUMMARY_MAX - 1).trimEnd()}…` : single;
}

export async function buildModelReportContent(
  run: (input: OwnerAgentRunInput) => Promise<OwnerAgentRunResult>,
  instructions: string,
  permissions: readonly OwnerAgentPermission[],
  period: ReportPeriod,
  nowMs: number,
): Promise<ReportContent> {
  const result = await run({
    prompt: buildReportPrompt(period, instructions, nowMs),
    systemPrompt: OWNER_AGENT_SYSTEM_PROMPT,
    permissions,
    model: OWNER_AGENT_MODEL,
    maxTurns: OWNER_AGENT_MAX_TURNS,
    timeoutMs: REPORT_MODEL_RUN_TIMEOUT_MS,
    // --no-session-persistence: a report is not a conversation, so no session
    // file is written for it at all.
    persistSession: false,
  });
  if (result.text.trim().length === 0) throw new Error('empty_answer');
  const text = answerBody(result.text, result.sqlUnavailable);
  return {
    text,
    // The custom template's two slots: the period and a one-line summary.
    // Nothing is padded for the numeric template's number slots.
    kind: 'custom',
    templateParams: [templateParam(period.label), templateSummary(result.text)],
    // The audit's tool_names: which tools the model used (store.ts sanitizes).
    sections: [],
    toolNames: result.toolNames,
    permissions: [...permissions],
  };
}
