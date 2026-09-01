// The activity history of one callback request, composed from columns that
// already exist.
//
// There is no event log for the sales tooling: no row is written when the agent
// calls get_pricing, apply_discount_tier or notify_owner, and there is no
// timeline table keyed by sales_call_attempt_id. What DOES exist is a set of
// timestamps each written exactly once by a known code path — created_at,
// wa_status_at, signup_completed_at, outcome_recorded_at, analysis_at — and
// each of those is a real, dated fact about this lead. This module turns those
// facts into one ordered list, and deliberately stops there: it invents no
// event it cannot point at a column for.
//
// Pure: no DB, no clock. The page supplies the DTO, this returns the list.

import type { SalesCallCrmSummary } from '@/lib/data/admin/callbacks';
import {
  aiCallSourceLabel,
  callAnalysisSuccessfulLabel,
  deliveryStatusLabel,
  salesDispatchStatusLabel,
} from '@/lib/data/admin/labels';
import { isTerminalCallbackStatus } from '@/lib/validation/admin';

export type ActivityEntry = {
  /** Stable React key — no index, so re-ordering never reuses a key. */
  key: string;
  /** The instant this entry is anchored to. */
  at: string;
  title: string;
  detail?: string;
  /**
   * A slot in the diary, not something that already happened. The list mixes
   * the two on purpose (an upcoming call belongs in the story of the lead), so
   * the UI has to be able to tell them apart.
   */
  planned?: boolean;
};

/** Only the fields an entry can be derived from — the rest of the DTO is display-only. */
export type TimelineSalesCall = Pick<
  SalesCallCrmSummary,
  | 'source'
  | 'attemptId'
  | 'dispatchStatus'
  | 'attemptCreatedAt'
  | 'attemptUpdatedAt'
  | 'waDeliveryStatus'
  | 'waDeliveryErrorCode'
  | 'waStatusAt'
  | 'signupCompletedAt'
  | 'outcomeRecordedAt'
  | 'hasAnalysis'
  | 'callSuccessful'
  | 'callSuccessScore'
  | 'analysisAt'
>;

export type TimelineInput = {
  createdAt: string;
  scheduledAt: string | null;
  /** callback_requests.status — free text in the DB, hence `string`. */
  status: string;
  salesCalls: TimelineSalesCall[];
};

// closeCallbackAppointment clears scheduled_at, but only once Exchange has
// actually archived the appointment — it returns early on failure and is
// best-effort besides. So a cancelled or closed request CAN still be holding
// the slot it was never called in, and calling that "מתוכנן" would promise a
// call that is not coming. "Still going somewhere" is CALLBACK_STATUS_KIND's
// question, asked once in validation/admin.ts — never a second copy of the
// terminal list here.

/**
 * Newest first, the way every other "what happened here" list in the product
 * reads — the current state of the lead is what the owner opens this for; the
 * origin story is what they scroll for.
 *
 * Equal timestamps keep insertion order (Array#sort is stable), so the
 * callback's own events stay above the calls they produced.
 */
export function buildCallbackActivity(input: TimelineInput): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    { key: 'callback:created', at: input.createdAt, title: 'הפנייה התקבלה' },
  ];

  if (input.scheduledAt) {
    const stillPlanned = !isTerminalCallbackStatus(input.status);
    entries.push({
      key: 'callback:scheduled',
      at: input.scheduledAt,
      title: stillPlanned ? 'מועד השיחה ביומן' : 'שובצה ביומן',
      planned: stillPlanned || undefined,
    });
  }

  input.salesCalls.forEach((call, index) => {
    const n = index + 1;
    // Every timestamp emitted for THIS attempt, so the catch-all below can tell
    // "the row changed for a reason we already show" from "the row changed and
    // this is the only trace of it".
    const emitted = new Set<string>();
    const push = (entry: ActivityEntry) => {
      emitted.add(entry.at);
      entries.push(entry);
    };

    push({
      key: `${call.attemptId}:created`,
      at: call.attemptCreatedAt,
      title: `${aiCallSourceLabel(call.source)} #${n} נוצרה`,
    });

    // wa_status_at is set ONLY by Meta's delivery report
    // (recordSalesWaDeliveryStatus). Until that report lands there is no
    // instant to place the send on — wa_message_id proves a link was sent but
    // carries no timestamp of its own — so the line appears when the report
    // does, rather than being anchored to an invented time.
    if (call.waStatusAt && call.waDeliveryStatus) {
      push({
        key: `${call.attemptId}:wa`,
        at: call.waStatusAt,
        title: `קישור הרשמה — ${deliveryStatusLabel(call.waDeliveryStatus)}`,
        detail: call.waDeliveryErrorCode ? `שגיאת מסירה ${call.waDeliveryErrorCode}` : undefined,
      });
    }

    if (call.signupCompletedAt) {
      push({
        key: `${call.attemptId}:signup`,
        at: call.signupCompletedAt,
        title: `הרשמה הושלמה בעקבות שיחה #${n}`,
      });
    }

    if (call.outcomeRecordedAt) {
      push({
        key: `${call.attemptId}:outcome`,
        at: call.outcomeRecordedAt,
        title: `תוצאת שיחה #${n} נרשמה`,
      });
    }

    if (call.hasAnalysis && call.analysisAt) {
      const score = call.callSuccessScore === null ? null : `ציון ${call.callSuccessScore}`;
      push({
        key: `${call.attemptId}:analysis`,
        at: call.analysisAt,
        title: `ניתוח ElevenLabs התקבל — ${aiCallSourceLabel(call.source)} #${n}`,
        detail: [callAnalysisSuccessfulLabel(call.callSuccessful), score]
          .filter(Boolean)
          .join(' · '),
      });
    }

    // updated_at is the row's own mtime, so it is only worth a line when it is
    // the ONLY evidence of the change — a call that connected, talked and hung
    // up without any tool ever firing leaves exactly this and nothing else.
    // Anything else would print a second, contentless row beside the event
    // that caused the update.
    if (!emitted.has(call.attemptUpdatedAt)) {
      push({
        key: `${call.attemptId}:updated`,
        at: call.attemptUpdatedAt,
        title: `שיחה #${n} — עדכון אחרון`,
        detail: salesDispatchStatusLabel(call.dispatchStatus),
      });
    }
  });

  // Parsed, not compared as strings: these columns are timestamptz and Postgres
  // renders them with a "+00:00" offset while anything constructed in JS ends
  // in "Z" — lexicographically those two sort apart even when they are the same
  // instant.
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
