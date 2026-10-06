import 'server-only';

import { getBillingSummary } from '@/lib/owner-agent/cores/billing';
import { getCampaignsStatusSummary } from '@/lib/owner-agent/cores/campaigns';
import { getEventsPipelineSummary } from '@/lib/owner-agent/cores/events';
import { getInquiriesSummary } from '@/lib/owner-agent/cores/inquiries';
import { getRsvpTotals } from '@/lib/owner-agent/cores/rsvp';
import { getVoiceCallsSummary } from '@/lib/owner-agent/cores/voice-calls';
import type { CoreWindow } from '@/lib/owner-agent/cores/window';
import type { OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import type { createAdminClient } from '@/lib/supabase/admin';

import { REPORT_CONTENT_TIMEOUT_MS } from './budgets';
import type { ReportPeriod } from './planner';

// The report's text, from the DETERMINISTIC cores (plans/owner-agent-chat-sdk-capabilities-plan.md
// §4.8) — no `claude -p`:
// no model cost, no injection surface, seconds rather than minutes. Numbers
// only, the same numbers the read tools give, and never a name, phone, event
// name or message text (the cores return none).
//
// PERMISSIONS decide the sections, per section, from the keys resolved for the
// staff member AT THE TIME OF THE REPORT (report.ts) — the same key each
// section's read tool sits behind (tools/*.ts, registry.ts). The mapping is
// restated here rather than imported: a tool module pulls in Mastra, and
// content.test.ts pins every key to the tool's own constant so the two cannot
// drift. A section without its key is absent from the text and is a fixed
// placeholder in the template — never the number.
//
// Errors THROW (the cores throw on a failed count): a report with a confident
// 0 where a query failed must not go out. report.ts lets the throw reach
// pg-boss, which retries before the send claim.

type AdminClient = ReturnType<typeof createAdminClient>;

/** Section id (= its read tool's id, recorded in the audit) → the permission it needs. */
export const REPORT_SECTION_PERMISSIONS = {
  events_pipeline: 'view_events',
  rsvp_totals: 'view_events',
  billing_summary: 'view_billing',
  inquiries_summary: 'view_customer_data',
  campaigns_status_summary: 'manage_billing',
  voice_calls_summary: 'manage_voice',
} as const satisfies Record<string, OwnerAgentPermission>;
export type ReportSection = keyof typeof REPORT_SECTION_PERMISSIONS;

const SECTION_ORDER = Object.keys(REPORT_SECTION_PERMISSIONS) as ReportSection[];

/** The permitted sections, in display order. Empty = nothing to report (`no_permissions`). */
export function permittedSections(permissions: readonly OwnerAgentPermission[]): ReportSection[] {
  const granted = new Set(permissions);
  return SECTION_ORDER.filter((s) => granted.has(REPORT_SECTION_PERMISSIONS[s]));
}

/** The template's value for a number the recipient may not see. */
export const TEMPLATE_PLACEHOLDER = '—';

interface ReportContentBase {
  /** The free-text report (inside the 24h window). */
  text: string;
  /** The deterministic sections that went in, for the audit (tool ids); [] for a model report. */
  sections: ReportSection[];
  /** A model report's tools, for the audit. */
  toolNames?: readonly string[];
  /**
   * Every permission the content was built with. report.ts re-checks at send
   * time that each is still granted — a report is never sent with data the
   * recipient lost the right to see while it was being written.
   */
  permissions: OwnerAgentPermission[];
}

/**
 * Two approved templates, and the content says which one it fits — the params
 * are bound to the template's kind, never padded into the other one's slots:
 *   - 'numeric' (owner_agent_report_template_*): {{1}}..{{4}} = period, new
 *     events, new RSVPs, revenue;
 *   - 'custom' (owner_agent_custom_report_template_*), a report written from
 *     the owner's instructions: {{1}} period, {{2}} a one-line summary.
 * Every param is single-line and never empty (templateParam).
 */
export type ReportContent =
  | (ReportContentBase & { kind: 'numeric'; templateParams: [string, string, string, string] })
  | (ReportContentBase & { kind: 'custom'; templateParams: [string, string] });

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function shekels(n: number): string {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₪`;
}

// Meta refuses a body parameter with a newline or a tab, or more than four
// spaces in a row (132000 family); an empty one fails the send. Every line or
// tab break (Unicode's included) becomes one space.
export function templateParam(value: string): string {
  const single = value.replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return single.length > 0 ? single : TEMPLATE_PLACEHOLDER;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('report_content_timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function buildReportContent(
  client: AdminClient,
  sections: readonly ReportSection[],
  period: ReportPeriod,
  nowMs: number,
  timeoutMs: number = REPORT_CONTENT_TIMEOUT_MS,
): Promise<ReportContent> {
  const want = new Set(sections);
  const window: CoreWindow = { sinceIso: period.sinceIso, untilIso: period.untilIso };
  // 'today' only feeds the one FORWARD field (events happening today, in the
  // snapshot); every range-bound field takes the window.
  const range = 'today' as const;
  const skip = Promise.resolve(null);

  const [events, rsvp, billing, inquiries, campaigns, voice] = await withTimeout(
    Promise.all([
      want.has('events_pipeline') ? getEventsPipelineSummary(client, range, nowMs, window) : skip,
      want.has('rsvp_totals') ? getRsvpTotals(client, range, nowMs, window) : skip,
      want.has('billing_summary') ? getBillingSummary(client, range, nowMs, window) : skip,
      want.has('inquiries_summary') ? getInquiriesSummary(client, range, nowMs, window) : skip,
      want.has('campaigns_status_summary') ? getCampaignsStatusSummary(client, range, nowMs, window) : skip,
      want.has('voice_calls_summary') ? getVoiceCallsSummary(client, range, nowMs, window) : skip,
    ]),
    timeoutMs,
  );

  const lines: string[] = [`דוח פעילות — ${period.label}`, ''];
  if (events) lines.push(`אירועים חדשים: ${count(events.createdInRange)}`);
  if (rsvp) lines.push(`אישורי הגעה חדשים: ${count(rsvp.responsesInRange)}`);
  if (billing) {
    lines.push(`הכנסות: ${shekels(billing.chargedAmountIls)} (${count(billing.chargedInRange)} חיובים)`);
  }
  if (inquiries) {
    lines.push(
      `פניות חדשות: ${count(inquiries.contactsReceived)}, בקשות חזרה: ${count(inquiries.callbacksReceived)}`,
    );
  }
  if (campaigns) lines.push(`קמפיינים חדשים: ${count(campaigns.createdInRange)}`);
  if (voice) lines.push(`שיחות AI: ${count(voice.attempts)} (הושלמו ${count(voice.completed)})`);

  if (period.includeSnapshot) {
    const snapshot: string[] = [];
    if (events) {
      snapshot.push(
        `אירועים פעילים: ${count(events.byStatus.active)}, מתוכם היום: ${count(events.activeUpcomingInWindow)}`,
      );
    }
    if (rsvp) snapshot.push(`אורחים שטרם ענו (באירועים פעילים): ${count(rsvp.pending)}`);
    if (billing) {
      snapshot.push(
        `חיובים שנכשלו: ${count(billing.chargesFailed)}, ממתינים לחיוב: ${count(billing.holdsAwaitingCharge)}`,
      );
    }
    if (inquiries) {
      snapshot.push(
        `פניות פתוחות: ${count(inquiries.openContacts)}, בקשות חזרה חדשות: ${count(inquiries.newCallbacks)}`,
      );
    }
    if (campaigns) snapshot.push(`קמפיינים שדורשים טיפול: ${count(campaigns.needsAttention)}`);
    if (voice) snapshot.push(`שיחות פעילות עכשיו: ${count(voice.activeNow)}`);
    if (snapshot.length > 0) lines.push('', 'מצב נוכחי:', ...snapshot);
  }

  return {
    kind: 'numeric',
    text: lines.join('\n'),
    templateParams: [
      templateParam(period.label),
      events ? count(events.createdInRange) : TEMPLATE_PLACEHOLDER,
      rsvp ? count(rsvp.responsesInRange) : TEMPLATE_PLACEHOLDER,
      billing ? templateParam(shekels(billing.chargedAmountIls)) : TEMPLATE_PLACEHOLDER,
    ],
    sections: SECTION_ORDER.filter((s) => want.has(s)),
    permissions: [...new Set(SECTION_ORDER.filter((s) => want.has(s)).map((s) => REPORT_SECTION_PERMISSIONS[s]))],
  };
}
