import { NextResponse } from 'next/server';
import { z } from 'zod';

import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/campaigns/{id}/status   body: { action: 'activate' | 'pause' }
//
// Console (Bearer/staff) campaign lifecycle control. The web app drives this via
// cookie-authed Server Actions (activateCampaign / pauseCampaign in
// src/lib/data/campaigns.ts), whose transitionCampaignStatus verifies identity with
// the cookie DAL (requireAdmin / requireOwnedEvent) — which a Bearer request does
// NOT have. This route mirrors THE SAME guarded transitions with console auth:
//
//   pause    : active → paused                          (safety / wind-down; no billing)
//   activate : approved | scheduled | paused → active   ONLY if capture_status =
//              'authorized' (the J5 authorization hold) AND the event is active.
//
// The J5 guard is preserved verbatim, so activation still cannot happen without the
// owner's approved payment hold (set up on the web). Keep the from-status sets and
// the capture_status guard in sync with transitionCampaignStatus. Note: unlike the
// web activateCampaign, this path does not seed the auto-thankyou default schedule
// (the owner sets it on the web); it never charges — the close-charge flow is
// unchanged and still owner-driven.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const uuidSchema = z.string().uuid();
const bodySchema = z.strictObject({ action: z.enum(['activate', 'pause']) });

// Statuses a campaign may be activated FROM — mirrors activateCampaign's `from`.
const ACTIVATE_FROM = ['approved', 'scheduled', 'paused'] as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!(await callerHasPlatformPermission(auth.ctx.supabase, 'manage_voice'))) {
    return json({ error: 'אין הרשאה' }, 403);
  }

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return json({ error: 'מזהה קמפיין לא תקין' }, 400);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  const { action } = parsed.data;

  // Read the target from OUR data only (service-role); decide from the real status.
  const admin = createAdminClient();
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .select('id, status, event_id, capture_status')
    .eq('id', id)
    .maybeSingle();
  if (cErr) return json({ error: 'טעינת הקמפיין נכשלה' }, 500);
  if (!campaign) return json({ error: 'הקמפיין לא נמצא' }, 404);

  if (action === 'pause') {
    if (campaign.status !== 'active') {
      return json({ error: 'ניתן להשהות רק קמפיין פעיל' }, 409);
    }
    // Guarded flip: only active → paused (CAS on status guards a concurrent change).
    const { error: upErr } = await admin
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', id)
      .eq('status', 'active');
    if (upErr) return json({ error: 'השהיית הקמפיין נכשלה' }, 500);
    return json({ ok: true, status: 'paused' }, 200);
  }

  // action === 'activate' — preserve every activateCampaign safeguard.
  if (!ACTIVATE_FROM.includes(campaign.status as (typeof ACTIVATE_FROM)[number])) {
    return json({ error: 'לא ניתן להפעיל את הקמפיין במצבו הנוכחי' }, 409);
  }
  if (campaign.capture_status !== 'authorized') {
    // The J5 authorization hold must be approved first (owner flow on the web).
    return json({ error: 'להפעלת הקמפיין נדרשת תפיסת מסגרת מאושרת' }, 409);
  }
  const { data: ev } = await admin
    .from('events')
    .select('status')
    .eq('id', campaign.event_id)
    .maybeSingle();
  if (ev?.status !== 'active') {
    return json({ error: 'האירוע אינו פעיל — לא ניתן להתחיל פנייה' }, 409);
  }

  // Guarded flip: only from a valid pre-send status AND with an authorized hold.
  const { error: upErr } = await admin
    .from('campaigns')
    .update({ status: 'active' })
    .eq('id', id)
    .in('status', ACTIVATE_FROM)
    .eq('capture_status', 'authorized');
  if (upErr) return json({ error: 'הפעלת הקמפיין נכשלה' }, 500);
  return json({ ok: true, status: 'active' }, 200);
}
