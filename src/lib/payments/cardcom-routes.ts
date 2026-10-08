import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { getCampaignForPurchase, type CampaignPurchaseState } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { isAllowedOrigin } from '@/lib/http/allowed-origin';

// What the two buyer-facing CardCom routes (open a session, settle it) check before anything else — the same gate the
// SUMIT purchase route applies, in JSON instead of redirects, because the buyer's browser calls these with fetch from the
// payment page (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, 4.3 and 4.6):
//   origin  → 403   a request from another site;
//   session → 401   not signed in;
//   owner   → 404   the campaign does not exist OR is not the caller's — the same answer for both, so ids cannot be probed.
// Authorization is always checked here, on the server, from the session: nothing the browser sends is trusted for it.

export type CampaignRouteGuard =
  | { ok: true; user: Awaited<ReturnType<typeof requireUser>>; campaign: CampaignPurchaseState; event: Awaited<ReturnType<typeof requireOwnedEvent>> }
  | { ok: false; response: NextResponse };

export const noStoreJson = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function guardCampaignRoute(request: NextRequest, campaignId: string): Promise<CampaignRouteGuard> {
  if (!isAllowedOrigin(request)) return { ok: false, response: noStoreJson({ status: 'forbidden' }, 403) };

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, response: noStoreJson({ status: 'unauthenticated' }, 401) };
  }

  const notFound = { ok: false as const, response: noStoreJson({ status: 'not_found' }, 404) };
  try {
    const campaign = await getCampaignForPurchase(campaignId);
    if (!campaign) return notFound;
    const event = await requireOwnedEvent(campaign.event_id);
    return { ok: true, user, campaign, event };
  } catch {
    return notFound;
  }
}
