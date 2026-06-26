import { type NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { getCampaignForHold } from '@/lib/data/campaigns';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';
import { whatsappSendSchema } from '@/lib/validation/campaigns';

// Manual owner-triggered WhatsApp send for a campaign (interim, until the
// pg-boss scheduler ships). Mirrors the J5 authorize route: CSRF + auth +
// ownership + fail-closed gate. The orchestrator re-checks every §8.3
// precondition; this route only gates + dispatches. Never log token/PII.

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
  // Redirects use the PUBLIC origin, not request.url (proxy host), per the J5 fix.
  const origin = process.env.APP_ORIGIN as string;

  try {
    await requireUser();
  } catch {
    return r303(new URL('/auth/login', origin));
  }

  const campaign = await getCampaignForHold(campaignId);
  if (!campaign) return r303(new URL('/app', origin));
  try {
    await requireOwnedEvent(campaign.event_id);
  } catch {
    return r303(new URL('/app', origin));
  }

  const eventUrl = (query: string) =>
    new URL(`/app/events/${campaign.event_id}?${query}`, origin);

  const formData = await request.formData();
  const parsed = whatsappSendSchema.safeParse({
    message_key: formData.get('message_key'),
  });
  if (!parsed.success) {
    return r303(eventUrl('wa=bad_request'));
  }

  // Fail-closed gate. The orchestrator re-checks these too, but gate here so a
  // disabled feature never reaches the provider path.
  const [enabled, config] = await Promise.all([
    getOutreachEnabled(),
    getWhatsAppConfig(),
  ]);
  if (!enabled || !config) {
    return r303(eventUrl('wa=disabled'));
  }

  const { sent, skipped } = await sendCampaignWhatsApp(
    campaignId,
    parsed.data.message_key,
  );
  return r303(eventUrl(`wa=done&sent=${sent}&skipped=${skipped}`));
}
