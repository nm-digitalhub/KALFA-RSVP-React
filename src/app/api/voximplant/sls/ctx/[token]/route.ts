import { NextResponse } from 'next/server';

import { getSalesVoiceContextByAccessToken } from '@/lib/data/sales-call-attempts';
import { getCompanyLegal } from '@/lib/data/company';
import { getClientIp, rateLimit } from '@/lib/security/rate-limit';
import { tokenFingerprint } from '@/lib/security/token-fingerprint';

// GET /api/voximplant/sls/ctx/{token}
//
// The sales-closing agent's Voximplant scenario fetches this once at call
// start. Same shape/discipline as mtg/ctx/[token] (which this deliberately
// mirrors) — opaque per-attempt access token in the path is the ONLY
// authorization. READ-ONLY. Every failure path returns the IDENTICAL generic
// 404, same public-rsvp-sentinel discipline as the meeting-booking surface.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CTX_RATE = { limit: 12, windowMs: 5 * 60 * 1000 } as const;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ip = getClientIp(req.headers.get.bind(req.headers));
  const fp = token ? tokenFingerprint(token) : 'none';
  if (!rateLimit(`vox-sls-ctx:${fp}:${ip}`, CTX_RATE).allowed) {
    return new NextResponse(null, { status: 429, headers: NO_STORE });
  }

  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
    return notFound();
  }

  let ctx;
  try {
    ctx = await getSalesVoiceContextByAccessToken(token);
  } catch {
    return notFound();
  }
  if (!ctx) return notFound();

  if (Date.parse(ctx.attempt.token_expires_at) <= Date.now()) return notFound();

  // Freshness re-verification — same reasoning as mtg/ctx's own comment: a
  // reschedule between dispatch and connect must degrade to the identical
  // generic 404, not a distinguishing status.
  if (
    ctx.request.status !== 'scheduled' ||
    !ctx.request.scheduled_at ||
    ctx.request.scheduled_at !== ctx.attempt.scheduled_at_snapshot
  ) {
    return notFound();
  }

  // First name only — same privacy discipline as every other ctx surface.
  const prospectName = ctx.request.full_name.trim().split(/\s+/)[0] || '';

  let companyName = '';
  let companyId = '';
  let companyAddress = '';
  try {
    const company = await getCompanyLegal();
    companyName = company.name ?? '';
    companyId = company.id ?? '';
    companyAddress = company.address ?? '';
  } catch {
    // Non-fatal: the agent's step-5 legal disclosure degrades to empty
    // values rather than blocking the whole call.
  }

  return NextResponse.json(
    {
      prospect_name: prospectName,
      note_text: ctx.request.note ?? '',
      company_name: companyName,
      company_id: companyId,
      company_address: companyAddress,
      kalfa_attempt_token: ctx.attempt.el_conversation_id ?? '',
    },
    { headers: NO_STORE },
  );
}
