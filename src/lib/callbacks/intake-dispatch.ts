import 'server-only';

import { buildIntakeSmsText } from '@/lib/callbacks/intake-sms';
import { mintCallbackIntakeToken } from '@/lib/data/callback-intake';
import { ilWallTimeToIso, todayIL } from '@/lib/data/event-date';
import { getSmsSender } from '@/lib/sms/sender';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppOrigin } from '@/lib/url';

// Arming the self-service intake link on a callback_requests row that a MISSED
// call created.
//
// Legally cleared by the owner on 2026-09-14 (see intake-sms.ts for the
// ruling). What remains is not a consent question but a spend one:
//
// ⚠️ THIS SPENDS MONEY AND REACHES A REAL HANDSET, once per missed call — which
// makes inbound volume a spend curve rather than a fixed cost. Three gates, in
// this order, and none of them is optional:
//
//  1. `callback_intake_sms_enabled`, default FALSE. The code shipping is not
//     the same event as the texting starting.
//  2. `callback_intake_sms_daily_cap`, counted over the Israel civil day. On
//     2026-08-17 this account took a flood of fraudulent inbound calls; with
//     no ceiling the same flood bills once per call. Past the cap the row and
//     the callback still happen — only the SMS stops.
//  3. A claim column, so two workers racing the same row send once.
//
// Never throws. Its caller is a missed-call handler whose real work already
// succeeded when the row was written; a failure here leaves the row exactly as
// it was before this feature existed, which is a working state.

type Gate = { send: boolean; reason?: 'disabled' | 'capped' | 'unreadable' };

async function readGate(): Promise<Gate> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('callback_intake_sms_enabled, callback_intake_sms_daily_cap')
    .eq('id', true)
    .maybeSingle();
  if (error || !data) return { send: false, reason: 'unreadable' };
  if (data.callback_intake_sms_enabled !== true) return { send: false, reason: 'disabled' };

  const cap = data.callback_intake_sms_daily_cap ?? 0;
  if (cap <= 0) return { send: false, reason: 'capped' };

  // The Israel CIVIL day, not a rolling 24h: a cap an operator can reason
  // about ("50 a day") has to reset when their day does.
  const dayStart = ilWallTimeToIso(todayIL(Date.now()), '00:00');
  const { count, error: countError } = await admin
    .from('callback_requests')
    .select('id', { count: 'exact', head: true })
    .gte('intake_sms_sent_at', dayStart);
  if (countError) return { send: false, reason: 'unreadable' };
  if ((count ?? 0) >= cap) return { send: false, reason: 'capped' };

  return { send: true };
}

/**
 * Mint the link and, if the gates allow, text it.
 *
 * The token is minted EVEN WHEN the SMS is gated off: it costs nothing, it
 * makes the row ready the moment an operator arms the feature, and a staff
 * member can pass the link on by hand.
 */
export async function armCallbackIntake(input: { requestId: string; phone: string }): Promise<void> {
  try {
    const token = await mintCallbackIntakeToken(input.requestId);
    if (!token) return; // already minted, or the update failed — either way, nothing to send

    const gate = await readGate();
    if (!gate.send) return;

    const admin = createAdminClient();
    // Claim-then-send: the update matches only while the claim is still null,
    // so a second caller finds nothing to claim and sends nothing.
    const { data: claimed } = await admin
      .from('callback_requests')
      .update({ intake_sms_claimed_at: new Date().toISOString() })
      .eq('id', input.requestId)
      .is('intake_sms_claimed_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) return;

    try {
      const sender = await getSmsSender();
      const text = buildIntakeSmsText({ formUrl: `${await getAppOrigin()}/cb/${token}` });
      const { id: providerId } = await sender.send({ to: input.phone, text });
      await admin
        .from('callback_requests')
        .update({
          intake_sms_sent_at: new Date().toISOString(),
          intake_sms_provider_id: providerId,
        })
        .eq('id', input.requestId);
    } catch (err) {
      // SMS switched off at the provider, an undialable number, an outage —
      // recorded for visibility, never surfaced. The message is the provider's
      // own; it carries no caller detail.
      await admin
        .from('callback_requests')
        .update({ intake_sms_error: err instanceof Error ? err.message : 'שגיאה לא ידועה' })
        .eq('id', input.requestId);
    }
  } catch {
    // See the header: the row is already written and already workable.
  }
}
