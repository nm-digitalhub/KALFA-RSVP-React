import { type NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { isPastEventDay } from '@/lib/data/event-date';
import {
  getCampaignForHold,
  lockCampaignForHold,
  prepareCampaignHold,
  recordCampaignHold,
  markCampaignHoldFailed,
} from '@/lib/data/campaigns';
import {
  getPaymentsEnabled,
  getCampaignHoldsEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { authorizeHoldSumit } from '@/lib/sumit/authorize';
import { SumitDeclinedError } from '@/lib/sumit/charge';
import { authorizeHoldSchema } from '@/lib/validation/campaigns';
import { VAT_RATE_PERCENT } from '@/lib/agreements/template';

// Route A J5 hold: place a SUMIT authorization hold (AutoCapture:false) up to the
// campaign ceiling after the agreement is signed. Mirrors the proven
// orders/[id]/pay handler: fail-closed gate, atomic lock (idempotency), and only
// a verified success persists the hold. The actual charge happens later at
// campaign close (B4) — this only reserves the frame.

const ERROR = {
  TOKEN_MISSING: 'token_missing',
  DISABLED: 'holds_disabled',
  BAD_STATE: 'bad_state',
  ALREADY: 'already_held',
  DECLINED: 'hold_declined',
  REVIEW: 'hold_review',
  EVENT_PAST: 'event_past',
  EVENT_NOT_ACTIVE: 'event_not_active',
} as const;

// CSRF: only our own origin may POST here. Fail-closed — no valid Origin/Referer
// → deny. (Replicated from the orders pay handler; APP_ORIGIN is server-only.)
function isAllowedOrigin(request: NextRequest): boolean {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN env var is not configured');
  const allowed = new Set([appOrigin]);
  if (process.env.NODE_ENV === 'development') {
    allowed.add('http://localhost:3002');
  }
  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin);
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

function r303(url: URL) {
  return NextResponse.redirect(url, 303);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params;

  if (!isAllowedOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Build redirects against the PUBLIC origin, not request.url — behind the nginx
  // proxy request.url reflects the internal host (127.0.0.1:3002), which would
  // send the browser to localhost. APP_ORIGIN is validated in isAllowedOrigin above.
  const origin = process.env.APP_ORIGIN as string;

  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return r303(new URL('/auth/login', origin));
  }

  const formData = await request.formData();
  const parsed = authorizeHoldSchema.safeParse({
    'og-token': formData.get('og-token'),
  });

  // Load the campaign + verify ownership before anything else.
  const campaign = await getCampaignForHold(campaignId);
  if (!campaign) {
    return r303(new URL('/app', origin));
  }
  let event: Awaited<ReturnType<typeof requireOwnedEvent>>;
  try {
    event = await requireOwnedEvent(campaign.event_id);
  } catch {
    return r303(new URL('/app', origin));
  }

  const payUrl = (error?: string) =>
    new URL(
      `/app/events/${campaign.event_id}/campaign/${campaignId}/payment${
        error ? `?error=${error}` : '?held=1'
      }`,
      origin,
    );

  // L1: no card hold for a past event (Israel calendar) — the campaign would
  // never legitimately activate, so don't reserve a frame on the card.
  if (isPastEventDay(event.event_date)) {
    return r303(payUrl(ERROR.EVENT_PAST));
  }
  // R9: every commercial campaign action requires event.status='active'. App
  // defense-in-depth — the DB trigger (campaigns_require_active_event) is the
  // REST-proof authority for the campaign-status side of this same rule.
  if (event.status !== 'active') {
    return r303(payUrl(ERROR.EVENT_NOT_ACTIVE));
  }

  if (!parsed.success) {
    return r303(payUrl(ERROR.TOKEN_MISSING));
  }

  // Fail-closed gate: master switch + hold switch + provider config, all
  // server-side. A disabled/unconfigured feature leaves the campaign untouched.
  const [paymentsEnabled, holdsEnabled] = await Promise.all([
    getPaymentsEnabled(),
    getCampaignHoldsEnabled(),
  ]);
  if (!paymentsEnabled || !holdsEnabled) {
    return r303(payUrl(ERROR.DISABLED));
  }
  const sumitConfig = await getSumitServerConfig();
  if (!sumitConfig) {
    console.error('[hold] enabled but SUMIT config missing', { campaignId });
    return r303(payUrl(ERROR.DISABLED));
  }

  // Must be a signed/approved campaign before any hold.
  if (campaign.status !== 'approved') {
    return r303(payUrl(ERROR.BAD_STATE));
  }

  // Idempotency: claim the hold slot atomically BEFORE the snapshot + sizing, so
  // ONLY the winner freezes the authorized set and sizes the hold. A loser
  // (already pending or authorized) must not place a second hold.
  if (!(await lockCampaignForHold(campaignId))) {
    return r303(payUrl(ERROR.ALREADY));
  }

  // Phase-2 money-leak guard. Freeze the authorized contact SET and size the hold
  // to the COVERED contacts (min(full, reasonable_coverage)) — NOT the full
  // ceiling. Also recomputes + persists max_contacts = full and the ceiling
  // (= full × price), closing the create→approval growth gap. Must run before the
  // card hold: the set is the binding cap that makes a hold < ceiling safe
  // (reached ⊆ set by construction). On failure, release the slot to a retryable
  // state and leave the campaign otherwise untouched.
  let holdAmount: number;
  try {
    ({ holdAmount } = await prepareCampaignHold(campaignId));
  } catch {
    console.error('[hold] failed to freeze the authorized set / size the hold', {
      campaignId,
    });
    await markCampaignHoldFailed(campaignId, 'hold_review');
    return r303(payUrl(ERROR.BAD_STATE));
  }
  if (!Number.isFinite(holdAmount) || holdAmount <= 0) {
    console.error('[hold] invalid hold amount', { campaignId });
    await markCampaignHoldFailed(campaignId, 'hold_review');
    return r303(payUrl(ERROR.BAD_STATE));
  }

  const authRef = crypto.randomUUID();
  try {
    const { authNumber, cardToken, expMonth, expYear, citizenId } =
      await authorizeHoldSumit({
        companyId: sumitConfig.companyId,
        apiKey: sumitConfig.apiKey,
        ogToken: parsed.data['og-token'],
        // The J5 hold amount (security) — covered-sized, NOT the full ceiling.
        ceiling: String(holdAmount), // numeric → string only at the SUMIT boundary
        vatRate: String(VAT_RATE_PERCENT),
        authRef,
        customerEmail: user.email ?? '',
      });
    await recordCampaignHold(campaignId, {
      authNumber,
      authAmount: holdAmount,
      cardToken, // saved card token + expiry + CitizenID, used at the capture
      expMonth,
      expYear,
      citizenId,
      authExternalRef: authRef, // reconciliation anchor on the charge
    });
  } catch (err) {
    if (err instanceof SumitDeclinedError) {
      console.error('[hold] authorization declined', { campaignId, authRef });
      await markCampaignHoldFailed(campaignId, 'hold_failed');
      return r303(payUrl(ERROR.DECLINED));
    }
    // Ambiguous outcome (network/technical/parse) — never assume a hold exists.
    console.error('[hold] ambiguous authorization outcome', { campaignId, authRef });
    await markCampaignHoldFailed(campaignId, 'hold_review');
    return r303(payUrl(ERROR.REVIEW));
  }

  return r303(payUrl());
}
