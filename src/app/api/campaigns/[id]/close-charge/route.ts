import { type NextRequest, NextResponse } from 'next/server';

import { requireUser, isAdmin } from '@/lib/auth/dal';
import { getCampaignForCharge } from '@/lib/data/campaigns';
import {
  getPaymentsEnabled,
  getCloseChargeEnabled,
  getSumitServerConfig,
} from '@/lib/data/payments';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { isAllowedOrigin } from '@/lib/http/allowed-origin';

// Admin-triggered campaign close + final charge of the held card. CSRF + auth +
// platform-admin + fail-closed gate; the amount is server-derived in the
// orchestrator (never read from the client). Redirects via APP_ORIGIN (proxy-safe).

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
  const origin = process.env.APP_ORIGIN as string;

  try {
    await requireUser();
  } catch {
    return r303(new URL('/auth/login', origin));
  }

  const campaign = await getCampaignForCharge(campaignId);
  if (!campaign) return r303(new URL('/app', origin));
  if (!(await isAdmin())) {
    return r303(new URL('/app', origin));
  }

  const eventUrl = (query: string) =>
    new URL(`/app/events/${campaign.event_id}?${query}`, origin);

  // Fail-closed gate (the orchestrator re-checks; gate here so a disabled feature
  // never reaches the charge path).
  const [paymentsOn, closeOn, sumit] = await Promise.all([
    getPaymentsEnabled(),
    getCloseChargeEnabled(),
    getSumitServerConfig(),
  ]);
  if (!paymentsOn || !closeOn || !sumit) {
    return r303(eventUrl('charge=disabled'));
  }

  const { outcome, amount } = await closeCampaignAndCharge(campaignId);
  return r303(eventUrl(`charge=${outcome}&amount=${amount}`));
}
