import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { activateAfterPayment, type ActivationResult } from '@/lib/payments/activate-after-payment';
import { settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { guardCampaignRoute, noStoreJson } from '@/lib/payments/cardcom-routes';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The buyer's browser calls this when the Open Fields form says it submitted (or errored) — docs/superpowers/plans/
// 2026-10-07-cardcom-pilot-plan.md, 4.6. It does NOT report an outcome: the browser's word, and the iframe's "HandleSubmit"
// message, are worth nothing. It only asks the server to find out from CardCom (settleCardcomSession), and then starts the
// campaign if — and only if — the payment is recorded. The session is looked up HERE, from the campaign: the browser names
// no session, so it cannot ask about anyone else's.
//
// The one thing the browser may say is `submitted: true`, after the form really submitted. It decides whether a session that
// CardCom says is unpaid is closed as failed (the buyer was declined and must try again) or left open (the buyer may still be
// typing). Lying about it only hurts the liar: a paid-after-failed payment raises an alert in settleCardcomSession.
const bodySchema = z.object({ submitted: z.literal(true).optional() });

type State = 'paid' | 'declined' | 'review' | 'in_progress' | 'none' | 'error';
type Answer = { state: Exclude<State, 'paid'> } | { state: 'paid'; activation: ActivationResult | 'not_needed' };

async function latestCardcomSession(campaignId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: operation } = await admin
    .from('payment_operations')
    .select('id, meta')
    .eq('campaign_id', campaignId)
    .eq('kind', 'package_purchase')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const meta = operation?.meta;
  if (!operation || meta === null || typeof meta !== 'object' || Array.isArray(meta) || meta.provider !== 'cardcom') return null;
  const { data: session } = await admin.from('cardcom_payment_sessions').select('low_profile_id').eq('operation_id', operation.id).maybeSingle();
  return session?.low_profile_id ?? null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;

  const guard = await guardCampaignRoute(request, campaignId);
  if (!guard.ok) return guard.response;
  const { campaign } = guard;

  let submitted = false;
  try {
    submitted = bodySchema.safeParse(await request.json()).data?.submitted === true;
  } catch {
    // No body, or not JSON: it carries nothing that matters. Treated as "not submitted".
  }

  let answer: Answer;
  try {
    const lowProfileId = await latestCardcomSession(campaignId);
    if (!lowProfileId) return noStoreJson({ state: 'none' } satisfies Answer);

    const settled = await settleCardcomSession(lowProfileId, { finalizeUnpaid: submitted });
    if (settled.status === 'not_found') answer = { state: 'none' };
    else if (settled.status === 'error') answer = { state: 'error' };
    else if (settled.status === 'unpaid') answer = { state: 'in_progress' };
    else if (settled.outcome === 'failed') answer = { state: 'declined' };
    else if (settled.outcome === 'review') answer = { state: 'review' };
    else {
      // Paid. Start the campaign only while it is still waiting for its payment: the webhook may have settled first, and a
      // campaign that is already running (or was changed meanwhile) must not be started twice.
      const fresh = await getCampaignForPurchase(campaignId);
      const activation = fresh?.status === 'approved' ? await activateAfterPayment(campaignId, campaign.event_id) : 'not_needed';
      answer = { state: 'paid', activation };
    }
  } catch (err) {
    console.error('[cardcom-settle-route] unexpected failure', { campaignId, kind: err instanceof Error ? err.name : typeof err });
    answer = { state: 'error' };
  }
  return noStoreJson(answer);
}
