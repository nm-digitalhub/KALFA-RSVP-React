import { firstSelectableKey, type ScheduleStepOption } from '@/lib/data/schedule-picker';
import { journeyRank } from '@/lib/whatsapp/journey-order';
import { LEAD_MESSAGE_KEYS } from '@/lib/whatsapp/template-route';
import { POST_EVENT_MESSAGE_KEYS } from '@/lib/whatsapp/template-spec';

// What an admin may pick for a step of a package's outreach schedule. PURE (no data access): the loader reads the
// rows, this decides. The rule for "a WhatsApp step that can be scheduled" lives here ONCE and is used by the picker
// (what is offered) and by the save-time validation (what is accepted), so the two can never disagree.

type RouteTemplate = { status: string | null } | null;
export type ScheduleStepRoute = {
  event_type: string | null;
  with_media: boolean;
  // PostgREST returns the embedded row as an object (to-one) — typed loosely because the generated type is a union.
  whatsapp_message_templates: unknown;
};

export type ScheduleStepRow = {
  message_key: string;
  channel: string;
  label: string | null;
  active: boolean;
  message_template_routes: readonly ScheduleStepRoute[] | null;
};

export const STEP_OFF_PROBLEM = 'השלב כבוי';
export const NO_APPROVED_TEMPLATE_PROBLEM = 'אין תבנית מאושרת ב-Meta';

// The default route (no event type, no media) points at a template Meta has APPROVED — exactly what the sender
// requires before it sends (whatsapp-template-send.ts).
export function hasApprovedDefaultRoute(routes: readonly ScheduleStepRoute[] | null | undefined): boolean {
  return (routes ?? []).some(
    (r) =>
      r.event_type === null &&
      !r.with_media &&
      (r.whatsapp_message_templates as RouteTemplate)?.status === 'APPROVED',
  );
}

export function buildScheduleOptions(rows: readonly ScheduleStepRow[]): ScheduleStepOption[] {
  const options: ScheduleStepOption[] = [];
  for (const row of rows) {
    const label = row.label?.trim() || row.message_key;
    if (row.channel === 'whatsapp') {
      // Not guest touchpoints of an event's schedule: a step sent to a sales lead, and a step that is only ever sent
      // after the event day (the send gate refuses everything else then).
      if (LEAD_MESSAGE_KEYS.has(row.message_key) || POST_EVENT_MESSAGE_KEYS.has(row.message_key)) continue;
      const problem = !row.active
        ? STEP_OFF_PROBLEM
        : !hasApprovedDefaultRoute(row.message_template_routes)
          ? NO_APPROVED_TEMPLATE_PROBLEM
          : null;
      options.push({ channel: row.channel, messageKey: row.message_key, label, problem });
    } else {
      // A call step's key is not read by anything today (it travels as the call request's scriptKey), so there is
      // nothing to check it against and nothing that makes it unpickable.
      options.push({ channel: row.channel, messageKey: row.message_key, label, problem: null });
    }
  }
  return options.sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      journeyRank(a.messageKey) - journeyRank(b.messageKey) ||
      a.messageKey.localeCompare(b.messageKey),
  );
}

export { firstSelectableKey, type ScheduleStepOption };
