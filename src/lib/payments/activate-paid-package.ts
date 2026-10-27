import 'server-only';

import { activateCampaignAfterPayment } from '@/lib/data/campaign-transition';
import { defaultThankyouSendAt } from '@/lib/data/event-date';
import { createAdminClient } from '@/lib/supabase/admin';

import { latestOperation } from './ledger';

// Starts the service of a package campaign once its payment is recorded on the server (design D23). No session: it is
// called by the pg-boss job that every recorded package payment queues, and inline by the browser routes, so a buyer
// who closes the tab still gets a running service. Every path runs this one function, and it is safe to run again:
//
//   - the status move is `approved → active` only, inside the guarded UPDATE (activateCampaignAfterPayment). A paused,
//     closed or cancelled campaign answers `not_applicable` and is left alone;
//   - completion checks before it writes. The thank-you default is set only while empty (the same guard a staff revival
//     uses, activateCampaign). The `campaign.activated` row is written by the call that moved the status. A later call that finds it
//     missing writes it only once the campaign has been quiet for REPAIR_AFTER_MS, and fails before that, so a run that
//     stopped between the status write and its completion is repaired by the job's next delivery, without racing a
//     concurrent winner.
//
// Throws when the start is refused (ledger unreadable or not collected, event past or not active, the named payment
// not a succeeded purchase of this campaign). The caller decides about retries and alerts; the payment stays recorded.
export type PaidActivationResult = 'started' | 'already_active' | 'not_applicable';

// Long enough that a concurrent winner has finished its own completion; shorter than the job's first retry delay.
export const REPAIR_AFTER_MS = 15_000;
export const ACTIVATION_ROW_PENDING = 'רישום הפעלת הקמפיין עדיין לא הושלם';

type Admin = ReturnType<typeof createAdminClient>;

export async function activatePaidPackage(campaignId: string, paymentOperationId: string): Promise<PaidActivationResult> {
  const admin = createAdminClient();
  const before = await readCampaign(admin, campaignId);

  if (before.status === 'approved') {
    try {
      const { eventDate } = await activateCampaignAfterPayment(campaignId, paymentOperationId);
      await recordActivation(admin, campaignId, before.event_id, paymentOperationId);
      await seedThankyou(admin, campaignId, eventDate);
      return 'started';
    } catch (err) {
      // Another call may have won the guarded UPDATE between the read and the move. That is a success, not an error.
      const now = await readCampaign(admin, campaignId);
      if (now.status !== 'active') throw err;
      await complete(admin, campaignId, now, paymentOperationId);
      return 'already_active';
    }
  }

  if (before.status === 'active') {
    await complete(admin, campaignId, before, paymentOperationId);
    return 'already_active';
  }

  return 'not_applicable';
}

type CampaignRow = { status: string; event_id: string; updated_at: string };

async function readCampaign(admin: Admin, campaignId: string): Promise<CampaignRow> {
  const { data, error } = await admin
    .from('campaigns')
    .select('status, event_id, updated_at')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error('טעינת הקמפיין נכשלה');
  if (!data) throw new Error('הקמפיין לא נמצא');
  return data;
}

// The completion of a campaign that is already active: the thank-you default if still empty, and the activation row
// only as a repair (missing, and nothing has touched the campaign for a minute).
async function complete(admin: Admin, campaignId: string, campaign: CampaignRow, paymentOperationId: string): Promise<void> {
  const { data: event, error } = await admin
    .from('events')
    .select('event_date')
    .eq('id', campaign.event_id)
    .maybeSingle();
  if (error) throw new Error('טעינת האירוע נכשלה');
  await seedThankyou(admin, campaignId, event?.event_date ?? null);

  const quietFor = Date.now() - new Date(campaign.updated_at).getTime();
  if (await hasActivationRow(admin, campaignId, campaign.event_id)) return;
  // Missing, but the campaign changed moments ago: a concurrent winner may still be writing it. Fail, so the job's
  // next delivery (PACKAGE_ACTIVATION_RETRY waits longer than this) checks again and repairs it if it is still missing.
  if (quietFor < REPAIR_AFTER_MS) throw new Error(ACTIVATION_ROW_PENDING);
  await recordActivation(admin, campaignId, campaign.event_id, paymentOperationId);
}

async function hasActivationRow(admin: Admin, campaignId: string, eventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('activity_log')
    .select('id')
    .eq('event_id', eventId)
    .eq('action', 'campaign.activated')
    .eq('meta->>campaignId', campaignId)
    .limit(1);
  if (error) throw new Error('טעינת יומן הפעילות נכשלה');
  return (data?.length ?? 0) > 0;
}

// No signed-in user: a direct insert, as the CardCom settlement and the orphan sweeper write theirs. Ids only.
async function recordActivation(admin: Admin, campaignId: string, eventId: string, paymentOperationId: string): Promise<void> {
  const { error } = await admin.from('activity_log').insert({
    event_id: eventId,
    user_id: null,
    action: 'campaign.activated',
    meta: { campaignId, actor: 'system', paymentOperationId },
  });
  if (error) throw new Error('רישום הפעלת הקמפיין נכשל');
}

// Only while empty: an owner-edited time is never replaced. A null or unreadable event date leaves it unset, as a
// staff revival does.
async function seedThankyou(admin: Admin, campaignId: string, eventDate: string | null): Promise<void> {
  const seeded = defaultThankyouSendAt(eventDate);
  if (!seeded) return;
  const { error } = await admin
    .from('campaigns')
    .update({ thankyou_send_at: seeded })
    .eq('id', campaignId)
    .is('thankyou_send_at', null);
  if (error) throw new Error('קביעת מועד הודעת התודה נכשלה');
}

// What a buyer's own request gets back: the service is running, or it is not yet (a later delivery of the job will
// start it; the screen says so). The browser routes call this inline, after the payment is recorded, so a buyer who
// stays sees a running service at once. It reads the payment the activation needs from the ledger (latestOperation)
// rather than trusting the request. Never throws.
export type ActivationResult = 'started' | 'failed';

export async function startPaidPackageNow(campaignId: string): Promise<ActivationResult> {
  try {
    const operation = await latestOperation(createAdminClient(), campaignId, 'package_purchase', 'succeeded');
    if (!operation) return 'failed';
    const result = await activatePaidPackage(campaignId, operation.id);
    return result === 'not_applicable' ? 'failed' : 'started';
  } catch (err) {
    console.error('[package-activation] inline start refused (the queued job retries)', {
      campaignId,
      message: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}
