import 'server-only';
import { createHash } from 'node:crypto';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';

// Delivery feed for the owner agent (plans/owner-agent-delivery-hardening-plan.md,
// stage 1). Meta reports what happened to each message we sent in a status
// webhook (sent / delivered / read / failed); the send API itself only says the
// request was ACCEPTED. Those webhooks already land in webhook_inbox for every
// message, but the shared processor matches only guest and sales messages — so
// an agent reply or report that Meta accepted and then failed to deliver was
// invisible. This writes one audit row per meaningful status of an agent
// message, and alerts on a failure.
//
// Recorded: delivered, read, failed. Not recorded: `sent` (one per message, no
// information beyond "accepted") and `played` (voice notes, which the agent
// never sends). `read` is kept because Meta skips `delivered` when the message
// is read straight away in an open chat (status webhook reference).

export const OWNER_AGENT_DELIVERY_STAGE = 'delivery';
const RECORDED_STATUSES = new Set(['delivered', 'read', 'failed']);
// Meta error codes are digits; anything else is not trusted into a reason code.
const META_CODE = /^[0-9]{1,12}$/;

export type OwnerAgentMessageMatch =
  | {
      kind: 'reply';
      intakeId: string;
      staffUserId: string | null;
      allowlistEntryId: string | null;
    }
  | {
      kind: 'report';
      reportRunId: string;
      allowlistEntryId: string | null;
    };

export interface DeliveryDeps {
  /** Whether the business number is the agent's — guest traffic stops here, one cached read. */
  isAgentNumber: (phoneNumberId: string) => Promise<boolean>;
  /** Which agent message this wamid is, or null when it is not the agent's. */
  findMessage: (wamid: string) => Promise<OwnerAgentMessageMatch | null>;
  writeAudit: (row: DeliveryAuditRow) => Promise<boolean>;
  alert: typeof sendSlackAlert;
}

export interface DeliveryAuditRow {
  stage: typeof OWNER_AGENT_DELIVERY_STAGE;
  outcome: string;
  reason_code: string | null;
  intake_id: string | null;
  report_run_id: string | null;
  staff_user_id: string | null;
  allowlist_entry_id: string | null;
  wamid_sha256: string;
}

export type DeliveryResult = 'not_ours' | 'ignored' | 'recorded' | 'audit_failed';

export function metaReasonCode(code: string | null): string | null {
  return code !== null && META_CODE.test(code) ? `meta_${code}` : null;
}

export async function recordOwnerAgentDelivery(
  wamid: string,
  phoneNumberId: string | null,
  status: string,
  errorCode: string | null,
  deps: DeliveryDeps = defaultDeps(),
): Promise<DeliveryResult> {
  if (!RECORDED_STATUSES.has(status)) return 'ignored';
  if (!phoneNumberId || !(await deps.isAgentNumber(phoneNumberId))) return 'not_ours';
  const match = await deps.findMessage(wamid);
  if (!match) return 'not_ours';

  const failed = status === 'failed';
  const reason = failed ? metaReasonCode(errorCode) : null;
  const ok = await deps.writeAudit({
    stage: OWNER_AGENT_DELIVERY_STAGE,
    outcome: status,
    reason_code: reason,
    intake_id: match.kind === 'reply' ? match.intakeId : null,
    report_run_id: match.kind === 'report' ? match.reportRunId : null,
    staff_user_id: match.kind === 'reply' ? match.staffUserId : null,
    allowlist_entry_id: match.allowlistEntryId,
    wamid_sha256: createHash('sha256').update(wamid).digest('hex'),
  });

  if (failed) {
    // Ids and the Meta code only — never a phone number or message text.
    await deps.alert({
      level: 'error',
      category: 'errors',
      source: 'owner-agent',
      title:
        match.kind === 'report'
          ? 'סוכן הבעלים — דוח לא נמסר'
          : 'סוכן הבעלים — תשובה לא נמסרה',
      detail: 'Meta קיבלה את ההודעה ואחר כך דיווחה שהמסירה נכשלה.',
      fields: {
        ...(match.kind === 'report' ? { run: match.reportRunId } : { intake: match.intakeId }),
        code: reason ?? 'unknown',
      },
    });
  }
  return ok ? 'recorded' : 'audit_failed';
}

// The agent's number, cached briefly: every guest status passes through here,
// and the setting changes only when the owner picks another number.
const AGENT_NUMBER_TTL_MS = 60_000;
let agentNumberCache: { value: string | null; at: number } | null = null;

function defaultDeps(): DeliveryDeps {
  const admin = createAdminClient();
  return {
    async isAgentNumber(phoneNumberId) {
      const now = Date.now();
      if (!agentNumberCache || now - agentNumberCache.at > AGENT_NUMBER_TTL_MS) {
        const { data, error } = await admin
          .from('app_settings')
          .select('owner_agent_phone_number_id')
          .eq('id', true)
          .maybeSingle();
        if (error) throw new Error('owner-agent delivery: settings lookup failed');
        agentNumberCache = { value: data?.owner_agent_phone_number_id ?? null, at: now };
      }
      return agentNumberCache.value === phoneNumberId;
    },
    async findMessage(wamid) {
      const { data: intake, error: intakeError } = await admin
        .from('owner_agent_intake')
        .select('id, staff_user_id, allowlist_entry_id')
        .contains('reply_wamids', [wamid])
        .limit(1)
        .maybeSingle();
      if (intakeError) throw new Error('owner-agent delivery: intake lookup failed');
      if (intake) {
        return {
          kind: 'reply',
          intakeId: intake.id,
          staffUserId: intake.staff_user_id,
          allowlistEntryId: intake.allowlist_entry_id,
        };
      }

      const { data: run, error: runError } = await admin
        .from('owner_agent_report_run')
        .select('id, owner_agent_report_subscription(allowlist_entry_id)')
        .eq('outbound_wamid', wamid)
        .limit(1)
        .maybeSingle();
      if (runError) throw new Error('owner-agent delivery: report lookup failed');
      if (!run) return null;
      const sub = run.owner_agent_report_subscription as { allowlist_entry_id: string } | null;
      return { kind: 'report', reportRunId: run.id, allowlistEntryId: sub?.allowlist_entry_id ?? null };
    },
    async writeAudit(row) {
      const { error } = await admin.from('owner_agent_audit').insert(row);
      return !error;
    },
    alert: sendSlackAlert,
  };
}
