import { type NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import {
  getCampaignForHold,
  lockCampaignForHold,
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
  try {
    await requireOwnedEvent(campaign.event_id);
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

  // Must be a signed/approved campaign with a valid server-derived ceiling.
  if (campaign.status !== 'approved') {
    return r303(payUrl(ERROR.BAD_STATE));
  }
  const ceiling = campaign.max_charge_ceiling;
  if (ceiling == null || !Number.isFinite(ceiling) || ceiling <= 0) {
    console.error('[hold] invalid ceiling on campaign', { campaignId });
    return r303(payUrl(ERROR.BAD_STATE));
  }

  // Idempotency: claim the hold slot atomically. A loser (already pending or
  // authorized) must not place a second hold.
  if (!(await lockCampaignForHold(campaignId))) {
    return r303(payUrl(ERROR.ALREADY));
  }

  const authRef = crypto.randomUUID();
  try {
    const { authNumber, cardToken, expMonth, expYear, citizenId } =
      await authorizeHoldSumit({
        companyId: sumitConfig.companyId,
        apiKey: sumitConfig.apiKey,
        ogToken: parsed.data['og-token'],
        ceiling: String(ceiling), // numeric → string only at the SUMIT boundary
        vatRate: String(VAT_RATE_PERCENT),
        authRef,
        customerEmail: user.email ?? '',
      });
    await recordCampaignHold(campaignId, {
      authNumber,
      authAmount: ceiling,
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
