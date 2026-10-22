import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { startPaidPackageNow, type ActivationResult } from '@/lib/payments/activate-paid-package';
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
//
// It may also carry what CardCom's frames announced about 3D Secure when they reported an error (`threeDs`: the error's number,
// the last step, and the label of CardCom's own fixed sentence — never text). It is written into the note of a row that this very
// call closes as failed, as "what the browser reported", so a refused 3D Secure can be told apart afterwards. It decides nothing, and a
// report that does not fit the shape is dropped without touching `submitted`.
const threeDsReportSchema = z.object({
  code: z.number().int().min(0).max(99_999_999).optional(),
  step: z.enum(['fingerprint', 'challenge']).optional(),
  reason: z.enum(['fail_auth', 'auth_error', 'general_error', 'timeout']).optional(),
});
// `method`: how the buyer paid as the form knows it — a card is only ever submitted from the form, so a result with none submitted is a
// wallet's. Same status as the rest of the report: written into a failed row's note, never read to decide anything.
const bodySchema = z.object({
  submitted: z.literal(true).optional(),
  method: z.enum(['card', 'google_pay']).optional().catch(undefined),
  threeDs: threeDsReportSchema.optional().catch(undefined),
});

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

  let submitted = false;
  let browserReport: (z.infer<typeof threeDsReportSchema> & { method?: 'card' | 'google_pay' }) | undefined;
  try {
    const body = bodySchema.safeParse(await request.json()).data;
    submitted = body?.submitted === true;
    // Only meaningful (and only used) when the form says it submitted.
    if (submitted) {
      const report = { ...(body?.method === undefined ? {} : { method: body.method }), ...(body?.threeDs ?? {}) };
      if (Object.keys(report).length > 0) browserReport = report;
    }
  } catch {
    // No body, or not JSON: it carries nothing that matters. Treated as "not submitted".
  }

  let answer: Answer;
  try {
    const lowProfileId = await latestCardcomSession(campaignId);
    if (!lowProfileId) return noStoreJson({ state: 'none' } satisfies Answer);

    const settled = await settleCardcomSession(lowProfileId, { finalizeUnpaid: submitted, ...(browserReport ? { browserReport } : {}) });
    if (settled.status === 'not_found') answer = { state: 'none' };
    else if (settled.status === 'error') answer = { state: 'error' };
    else if (settled.status === 'unpaid') answer = { state: 'in_progress' };
    else if (settled.outcome === 'failed') answer = { state: 'declined' };
    else if (settled.outcome === 'review') answer = { state: 'review' };
    else {
      // Paid. Start the campaign only while it is still waiting for its payment: the webhook may have settled first, and a
      // campaign that is already running (or was changed meanwhile) must not be started twice.
      const fresh = await getCampaignForPurchase(campaignId);
      // The settlement that recorded the payment also queued the start (design D23); this inline call is the same
      // idempotent function, so a buyer who stays sees a running service at once.
      const activation = fresh?.status === 'approved' ? await startPaidPackageNow(campaignId) : 'not_needed';
      answer = { state: 'paid', activation };
    }
  } catch (err) {
    console.error('[cardcom-settle-route] unexpected failure', { campaignId, kind: err instanceof Error ? err.name : typeof err });
    answer = { state: 'error' };
  }
  return noStoreJson(answer);
}
